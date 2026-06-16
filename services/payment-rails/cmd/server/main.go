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
	"bis/payment-rails/internal/backpressure"
	"bis/payment-rails/internal/handlers"
	"bis/payment-rails/internal/kafka"
	"bis/payment-rails/internal/tigerbeetle"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func main() {
	zerolog.TimeFieldFormat = time.RFC3339
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})
	cfg := config.Load()

	// TigerBeetle hot-tier ledger client
	// Lesson: 48K sustained / 63K burst TPS via O_DIRECT + io_uring + circular WAL (zero fsyncs)
	if cfg.TigerBeetleURL != "" {
		os.Setenv("TIGERBEETLE_URL", cfg.TigerBeetleURL)
	}
	tbClient := tigerbeetle.New()
	initCtx, initCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := tbClient.EnsureSystemAccounts(initCtx); err != nil {
		log.Warn().Err(err).Msg("[TigerBeetle] Could not bootstrap system accounts")
	}
	initCancel()

	// Backpressure limiter — return 503 early when pipeline is saturated
	bp := backpressure.New(cfg.MaxInflightTransfers)

	// Real Kafka publisher (falls back to no-op stub when KAFKA_BROKERS is unset).
	kafkaCfg := kafka.LoadConfigFromEnv()
	kafkaPublisher := kafka.New(kafkaCfg)
	defer kafkaPublisher.Close()

	swiftH := handlers.NewSWIFTHandler(cfg.AMLEngineURL, kafkaPublisher)
	sepaH := handlers.NewSEPAHandler(kafkaPublisher)
	travelH := handlers.NewTravelRuleHandler(kafkaPublisher)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(corsMiddleware)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "ok",
			"service": "payment-rails",
			"version": "1.1.0",
			"kafka": map[string]interface{}{
				"enabled": kafkaCfg.Brokers != "",
				"brokers": kafkaCfg.Brokers,
			},
			"tigerbeetle": map[string]interface{}{
				"enabled":        cfg.TigerBeetleURL != "",
				"pending_batch":  tbClient.PendingCount(),
				"max_batch_size": tigerbeetle.MaxBatchSize,
			},
			"backpressure": map[string]interface{}{
				"in_flight": bp.Current(),
				"available": bp.Available(),
				"max":       cfg.MaxInflightTransfers,
			},
			"timestamp": time.Now().UTC(),
		})
	})

	r.Get("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		fmt.Fprintf(w, "payment_rails_inflight_transfers %d\n", bp.Current())
		fmt.Fprintf(w, "payment_rails_tb_pending_batch %d\n", tbClient.PendingCount())
		fmt.Fprintf(w, "payment_rails_tb_max_batch_size %d\n", tigerbeetle.MaxBatchSize)
	})

	r.Route("/api/swift", func(r chi.Router) {
		r.Use(bp.Middleware)
		r.Post("/mt103", swiftH.HandleMT103)
		r.Post("/mt202", swiftH.HandleMT202)
		r.Get("/gpi/{uetr}", swiftH.HandleGPITrack)
	})

	r.Route("/api/sepa", func(r chi.Router) {
		r.Use(bp.Middleware)
		r.Post("/credit-transfer", sepaH.HandleCreditTransfer)
		r.Post("/direct-debit", sepaH.HandleDirectDebit)
		r.Post("/instant", sepaH.HandleInstant)
	})

	r.Route("/api/travel-rule", func(r chi.Router) {
		r.Use(bp.Middleware)
		r.Post("/send", travelH.HandleSend)
		r.Post("/receive", travelH.HandleReceive)
		r.Get("/thresholds", travelH.HandleThresholds)
	})

	r.Route("/api/ledger", func(r chi.Router) {
		r.Get("/balance/{accountId}", func(w http.ResponseWriter, r *http.Request) {
			accountID := chi.URLParam(r, "accountId")
			balance, err := tbClient.GetBalance(r.Context(), accountID)
			if err != nil {
				http.Error(w, `{"error":"ledger_error"}`, http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"account_id": accountID,
				"balance":    balance,
				"currency":   "NGN",
				"unit":       "kobo",
			})
		})
	})

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", cfg.Port),
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Info().Str("port", cfg.Port).
			Int("max_batch_size", cfg.MaxBatchSize).
			Int("max_inflight", cfg.MaxInflightTransfers).
			Bool("kafka_enabled", kafkaCfg.Brokers != "").
			Msg("Payment Rails service starting")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("Server failed")
		}
	}()

	<-quit
	log.Info().Msg("Shutting down payment-rails service...")
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutCancel()

	if results, err := tbClient.FlushPending(shutCtx); err != nil {
		log.Error().Err(err).Msg("[TigerBeetle] Failed to flush pending batch on shutdown")
	} else if len(results) > 0 {
		log.Info().Int("flushed", len(results)).Msg("[TigerBeetle] Flushed pending batch on shutdown")
	}

	if err := srv.Shutdown(shutCtx); err != nil {
		log.Error().Err(err).Msg("Server forced shutdown")
	}
	log.Info().Msg("Payment Rails service stopped")
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID, X-Idempotency-Key")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
