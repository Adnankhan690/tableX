// Command server runs the tableX API.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"tablex/cmd/app"
	"tablex/internal/config"
	"tablex/internal/logger"
)

func main() {
	configPath := flag.String("config", "config/local.yml", "path to the configuration file")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		// Printed as-is. config.Validate already produces a readable multi-line list of every
		// problem at once; wrapping it would bury the detail an operator needs.
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}

	log := logger.New(os.Stdout, cfg.Log.Level, cfg.Log.Format)

	application, err := app.New(cfg, log)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to start: %v\n", err)
		os.Exit(1)
	}

	// Registered before Run so a signal arriving during startup is not lost.
	shutdownCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() { errCh <- application.Run() }()

	select {
	case err := <-errCh:
		if err != nil {
			fmt.Fprintf(os.Stderr, "server error: %v\n", err)
			os.Exit(1)
		}

	case <-shutdownCtx.Done():
		// A bounded context, so a client holding a connection open cannot stall the deploy
		// indefinitely. Long enough for an order-placement transaction to commit.
		drainCtx, cancel := context.WithTimeout(context.Background(), cfg.Server.ShutdownTimeout)
		defer cancel()

		if err := application.Shutdown(drainCtx); err != nil {
			fmt.Fprintf(os.Stderr, "shutdown error: %v\n", err)
			os.Exit(1)
		}
	}
}
