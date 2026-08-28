// Package app wires the application together and owns its lifecycle.
package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"tablex/cmd/app/middlewares"
	"tablex/internal/config"
	"tablex/internal/controllers"
	"tablex/internal/db"
	"tablex/internal/logger"
	"tablex/internal/payments"
	"tablex/internal/realtime"
	"tablex/internal/repositories"
	"tablex/internal/services"
	"tablex/internal/storage"
)

// App holds every constructed dependency and the HTTP server.
type App struct {
	cfg    *config.Config
	logger logger.Logger

	db          *db.Store
	hub         *realtime.Hub
	repos       *repositories.Repositories
	services    *services.Services
	controllers *controllers.Controllers
	middlewares *middlewares.Middlewares

	engine *gin.Engine
	server *http.Server
}

// New constructs the application. Every failure here is fatal and reported to the caller
// rather than logged and swallowed: a half-built application should not start listening.
func New(cfg *config.Config, log logger.Logger) (*App, error) {
	store, err := db.Open(&cfg.Database)
	if err != nil {
		return nil, fmt.Errorf("app: database: %w", err)
	}

	// Verified before anything else is built. Discovering an unreachable database on the first
	// diner's request, rather than at boot, means a deploy reports success and the restaurant
	// finds out instead.
	if err := store.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("app: database unreachable: %w", err)
	}

	var hub *realtime.Hub
	if cfg.Realtime.Enabled {
		hub = realtime.NewHub(cfg.Realtime.SendBufferSize, log)
	}

	repos := repositories.NewRepositories(cfg, store, log)
	providers := buildPaymentRegistry(cfg, log)

	objects, err := buildObjectStore(cfg, log)
	if err != nil {
		return nil, fmt.Errorf("app: object storage: %w", err)
	}

	svcs := services.NewServices(cfg, store, log, repos, providers, objects, hub)
	ctrls := controllers.NewControllers(cfg, log, svcs, hub, store)
	mws := middlewares.New(cfg, log, svcs)

	app := &App{
		cfg:         cfg,
		logger:      log,
		db:          store,
		hub:         hub,
		repos:       repos,
		services:    svcs,
		controllers: ctrls,
		middlewares: mws,
	}

	app.engine = app.buildEngine()
	app.server = &http.Server{
		Addr:         cfg.Server.Addr(),
		Handler:      app.engine,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
	}

	return app, nil
}

// buildPaymentRegistry assembles the available payment providers (DECISIONS.md D2).
//
// Static UPI is always the fallback, so a restaurant configured for a gateway this
// deployment has no credentials for can still take payment rather than showing a broken
// checkout.
func buildPaymentRegistry(cfg *config.Config, log logger.Logger) *payments.Registry {
	entry := log.With(context.Background())

	fallback := payments.NewUPIStatic(cfg.Payments.UPIStaticNote)
	available := []payments.Provider{}

	// The mock settles any payment it is handed. Registering it in production would put a
	// "mark this order paid" provider one configuration typo away from being live, so it is
	// gated on the environment rather than on a config flag someone could set.
	if !cfg.IsProduction() {
		available = append(available, payments.NewMock())
		entry.Infof("[buildPaymentRegistry] mock provider registered (env=%s)", cfg.App.Env)
	}

	razorpay := payments.NewRazorpay(
		cfg.Payments.Razorpay.KeyID,
		cfg.Payments.Razorpay.KeySecret,
		cfg.Payments.Razorpay.WebhookSecret,
		cfg.Payments.Razorpay.BaseURL,
	)
	if razorpay.Configured() {
		available = append(available, razorpay)
		entry.Infof("[buildPaymentRegistry] razorpay registered")
	} else {
		entry.Infof("[buildPaymentRegistry] razorpay credentials absent, gateway disabled")
	}

	registry := payments.NewRegistry(fallback, available...)
	entry.Infof("[buildPaymentRegistry] providers: %v", registry.Names())
	return registry
}

// buildObjectStore constructs the store dish photographs live in (DECISIONS.md D15).
//
// Same shape as the Razorpay adapter above: credentials decide. A deployment with none gets
// a store that refuses writes and resolves every key to the empty string, so "this
// deployment hosts no images" is one object rather than a nil check on every read path.
//
// A HALF-FILLED BLOCK NEVER REACHES HERE -- config.Validate rejects it at startup, because
// silently disabling uploads would let a deploy that was meant to enable them look
// successful. That makes the error below unreachable today; it is propagated rather than
// logged so it stays that way if a future option can fail.
func buildObjectStore(cfg *config.Config, log logger.Logger) (storage.Storage, error) {
	entry := log.With(context.Background())

	if !cfg.Storage.UploadsEnabled() {
		entry.Infof("[buildObjectStore] no R2 credentials configured, dish photo uploads are disabled -- " +
			"set TABLEX_R2_* to enable them. Dishes can still carry a pasted image_url.")
		return storage.NewUnconfigured(), nil
	}

	objects, err := storage.NewR2(storage.R2Options{
		AccountID:       cfg.Storage.R2.AccountID,
		AccessKeyID:     cfg.Storage.R2.AccessKeyID,
		SecretAccessKey: cfg.Storage.R2.SecretAccessKey,
		Bucket:          cfg.Storage.R2.Bucket,
		PublicBaseURL:   cfg.Storage.R2.PublicBaseURL,
		PresignTTL:      cfg.Storage.PresignTTL,
	})
	if err != nil {
		return nil, err
	}

	// The bucket name and public origin are logged; the credentials are not.
	entry.Infof("[buildObjectStore] R2 bucket %q ready, images served from %s (max %d bytes per upload)",
		cfg.Storage.R2.Bucket, cfg.Storage.R2.PublicBaseURL, cfg.Storage.MaxUploadBytes)
	return objects, nil
}

// buildEngine configures Gin and installs the middleware chain.
func (a *App) buildEngine() *gin.Engine {
	if a.cfg.IsLocal() {
		gin.SetMode(gin.DebugMode)
	} else {
		gin.SetMode(gin.ReleaseMode)
	}

	// gin.New, not gin.Default: Default installs its own logger and recovery, which would
	// duplicate every log line and bypass our envelope on a panic.
	engine := gin.New()

	// Left unset, Gin trusts X-Forwarded-For from any source, which makes ClientIP -- and
	// therefore the rate limiter -- trivially spoofable. config.Validate requires this in
	// production for that reason.
	if len(a.cfg.Server.TrustedProxies) > 0 {
		if err := engine.SetTrustedProxies(a.cfg.Server.TrustedProxies); err != nil {
			a.logger.With(context.Background()).Errorf("[buildEngine] trusted proxies: %v", err)
		}
	} else {
		// Nil means trust nothing and read the direct peer address. Correct for local
		// development and safe by default everywhere else.
		_ = engine.SetTrustedProxies(nil)
	}

	// Order is deliberate and load-bearing:
	//   Recovery first, so it wraps everything including the middleware below it.
	//   RequestID next, so every later log line -- including a panic -- carries the id.
	//   Logging after RequestID so it can include it.
	//   CORS last, so a rejected preflight is still logged and still correlated.
	engine.Use(
		a.middlewares.Recovery(),
		a.middlewares.RequestID(),
		a.middlewares.Logging(),
		a.middlewares.CORS(),
	)

	a.addRoutes(engine)
	return engine
}

// Run starts listening and blocks until the server stops.
func (a *App) Run() error {
	a.logger.With(context.Background()).Infof(
		"[Run] tableX listening on %s (env=%s, realtime=%v)",
		a.cfg.Server.Addr(), a.cfg.App.Env, a.cfg.Realtime.Enabled)

	if err := a.server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("app: listen: %w", err)
	}
	return nil
}

// Shutdown stops the server gracefully and releases everything.
//
// The ordering matters. In-flight requests drain first, because an order-placement
// transaction killed halfway is exactly the lost order PRD 7 forbids. Only once they are
// done are the socket subscribers disconnected and the database closed.
func (a *App) Shutdown(ctx context.Context) error {
	log := a.logger.With(ctx)
	log.Infof("[Shutdown] draining in-flight requests")

	var firstErr error

	if err := a.server.Shutdown(ctx); err != nil {
		log.Errorf("[Shutdown] server: %v", err)
		firstErr = err
	}

	// After the drain: a client disconnected mid-request would otherwise see its socket close
	// before its response arrived.
	if a.hub != nil {
		a.hub.Close()
	}
	a.middlewares.Close()

	if err := a.db.Close(); err != nil {
		log.Errorf("[Shutdown] database: %v", err)
		if firstErr == nil {
			firstErr = err
		}
	}

	log.Infof("[Shutdown] complete")
	return firstErr
}

// Engine exposes the router, for tests that exercise routes without a listener.
func (a *App) Engine() *gin.Engine { return a.engine }
