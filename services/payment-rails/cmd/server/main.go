package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"bis/payment-rails/config"
	"bis/payment-rails/internal/handlers"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// stubKafka is a no-op publisher used when Kafka is unavailable
type stubKafka struct{}

func (s *stubKafka) Publish(_ context.Context, topic, key string, value []byte) error {
	log.Debug().Str("topic", topic).Str("key", key).Msg("Kafka stub: event published")
	return nil
}

func main() {
	// Logger
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})

	cfg := config.Load()

	// Kafka publisher (stub — replace with real segmentio/kafka-go writer in production)
	kafka := &stubKafka{}

	// Handlers
	swiftH := handlers.NewSWIFTHandler(cfg.AMLEngineURL, kafka)
	sepaH := handlers.NewSEPAHandler(kafka)
	travelH := handlers.NewTravelRuleHandler(kafka)

	// Router
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(corsMiddleware)

	// Health
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":    "ok",
			"service":   "payment-rails",
			"version":   "1.0.0",
			"timestamp": time.Now().UTC(),
		})
	})

	// SWIFT routes
	r.Route("/api/swift", func(r chi.Router) {
		r.Post("/mt103", swiftH.HandleMT103)
		r.Post("/mt202", swiftH.HandleMT202)
		r.Get("/gpi/{uetr}", swiftH.HandleGPITrack)
	})

	// SEPA routes
	r.Route("/api/sepa", func(r chi.Router) {
		r.Post("/credit-transfer", sepaH.HandleCreditTransfer)
		r.Post("/direct-debit", sepaH.HandleDirectDebit)
		r.Post("/instant", sepaH.HandleInstant)
	})

	// Travel Rule routes (FATF R.16)
	r.Route("/api/travel-rule", func(r chi.Router) {
		r.Post("/send", travelH.HandleSend)
		r.Post("/receive", travelH.HandleReceive)
		r.Get("/thresholds", travelH.HandleThresholds)
	})

	// Server
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", cfg.Port),
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Info().Str("port", cfg.Port).Msg("Payment Rails service starting")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("Server failed")
		}
	}()

	<-quit
	log.Info().Msg("Shutting down payment-rails service...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Error().Err(err).Msg("Server forced shutdown")
	}
	log.Info().Msg("Payment Rails service stopped")
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
