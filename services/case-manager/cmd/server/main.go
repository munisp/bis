// cmd/server/main.go — BIS Case Manager Service (Go + Gin)
// Provides REST API for case management with JWT auth, Kafka event emission,
// and Permify authorization checks.
package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/bis-platform/case-manager/config"
	"github.com/bis-platform/case-manager/internal/handlers"
	"github.com/bis-platform/case-manager/internal/middleware"
	"github.com/bis-platform/case-manager/internal/repository"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func main() {
	// ── Logging ──────────────────────────────────────────────────────────────
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})

	// ── Config ───────────────────────────────────────────────────────────────
	_ = godotenv.Load("../../.env")
	cfg := config.Load()

	// ── Database ─────────────────────────────────────────────────────────────
	db, err := repository.NewPostgresDB(cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to connect to database")
	}
	defer db.Close()

	// ── Kafka producer ───────────────────────────────────────────────────────
	producer := handlers.NewKafkaProducer(cfg.KafkaBrokers, "bis.case.events")
	defer producer.Close()

	// ── Repositories ─────────────────────────────────────────────────────────
	caseRepo := repository.NewCaseRepository(db)
	partyRepo := repository.NewPartyRepository(db)
	docRepo := repository.NewDocumentRepository(db)
	timelineRepo := repository.NewTimelineRepository(db)
	stakeholderRepo := repository.NewStakeholderRepository(db)
	commentRepo := repository.NewCommentRepository(db)

	// ── Handlers ─────────────────────────────────────────────────────────────
	caseHandler := handlers.NewCaseHandler(caseRepo, timelineRepo, producer)
	partyHandler := handlers.NewPartyHandler(partyRepo, timelineRepo)
	docHandler := handlers.NewDocumentHandler(docRepo, timelineRepo, cfg.S3Bucket, cfg.S3Region)
	stakeholderHandler := handlers.NewStakeholderHandler(stakeholderRepo, timelineRepo, cfg.AppBaseURL)
	commentHandler := handlers.NewCommentHandler(commentRepo, timelineRepo, stakeholderRepo)

	// ── Router ───────────────────────────────────────────────────────────────
	if cfg.Env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(middleware.RequestLogger())
	r.Use(middleware.CORS(cfg.AllowedOrigins))

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "case-manager", "version": "1.0.0"})
	})

	// ── API v1 ───────────────────────────────────────────────────────────────
	v1 := r.Group("/api/v1")

	// Authenticated routes (JWT required)
	auth := v1.Group("/")
	auth.Use(middleware.JWTAuth(cfg.JWTSecret))
	{
		// Cases
		cases := auth.Group("/cases")
		{
			cases.GET("", caseHandler.ListCases)
			cases.POST("", caseHandler.CreateCase)
			cases.GET("/:ref", caseHandler.GetCase)
			cases.PATCH("/:ref", caseHandler.UpdateCase)
			cases.DELETE("/:ref", caseHandler.ArchiveCase)
			cases.POST("/:ref/status", caseHandler.UpdateCaseStatus)

			// Parties
			cases.GET("/:ref/parties", partyHandler.ListParties)
			cases.POST("/:ref/parties", partyHandler.AddParty)
			cases.PATCH("/:ref/parties/:partyId", partyHandler.UpdateParty)
			cases.DELETE("/:ref/parties/:partyId", partyHandler.RemoveParty)

			// Documents
			cases.GET("/:ref/documents", docHandler.ListDocuments)
			cases.POST("/:ref/documents", docHandler.UploadDocument)
			cases.DELETE("/:ref/documents/:docId", docHandler.DeleteDocument)

			// Timeline
			cases.GET("/:ref/timeline", caseHandler.GetTimeline)

			// Stakeholders
			cases.GET("/:ref/stakeholders", stakeholderHandler.ListStakeholders)
			cases.POST("/:ref/stakeholders", stakeholderHandler.InviteStakeholder)
			cases.DELETE("/:ref/stakeholders/:stakeholderId", stakeholderHandler.RevokeStakeholder)

			// Comments
			cases.GET("/:ref/comments", commentHandler.ListComments)
			cases.POST("/:ref/comments", commentHandler.AddComment)
		}
	}

	// Stakeholder portal routes (access token, no JWT)
	portal := v1.Group("/portal")
	portal.Use(middleware.StakeholderTokenAuth(cfg.JWTSecret))
	{
		portal.GET("/cases/:ref", caseHandler.GetCaseForStakeholder)
		portal.GET("/cases/:ref/documents", docHandler.ListDocumentsForStakeholder)
		portal.GET("/cases/:ref/timeline", caseHandler.GetTimelineForStakeholder)
		portal.POST("/cases/:ref/comments", commentHandler.AddStakeholderComment)
	}

	// ── Server ───────────────────────────────────────────────────────────────
	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Info().Str("port", cfg.Port).Msg("[CaseManager] Server starting")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("Server failed")
		}
	}()

	// ── Graceful shutdown ─────────────────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Info().Msg("[CaseManager] Shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Error().Err(err).Msg("Server forced to shutdown")
	}
	log.Info().Msg("[CaseManager] Stopped")
}
