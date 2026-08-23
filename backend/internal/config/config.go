// Package config loads application configuration from a YAML file, with environment
// variables taking precedence.
//
// The precedence order -- defaults, then file, then environment -- is what lets one image
// run in every environment: the file carries the shape and the safe local values, and the
// deployment supplies only the secrets.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Config is the whole of the application's configuration.
type Config struct {
	App      AppConfig      `yaml:"app"`
	Server   ServerConfig   `yaml:"server"`
	Database DatabaseConfig `yaml:"database"`
	Auth     AuthConfig     `yaml:"auth"`
	Guest    GuestConfig    `yaml:"guest"`
	Payments PaymentsConfig `yaml:"payments"`
	Realtime RealtimeConfig `yaml:"realtime"`
	Log      LogConfig      `yaml:"log"`
}

// AppConfig holds identity and the public URLs used to build QR codes.
type AppConfig struct {
	Name string `yaml:"name"`
	// Env is one of local, staging, production. Gates seeding and debug behaviour.
	Env string `yaml:"env"`
	// DinerBaseURL is the origin encoded into every table QR code. Getting this wrong
	// prints a floor's worth of QR stickers that point at the wrong host, so it is
	// validated at startup rather than discovered later.
	DinerBaseURL string `yaml:"diner_base_url"`
	AdminBaseURL string `yaml:"admin_base_url"`
}

// ServerConfig holds HTTP listener settings.
type ServerConfig struct {
	Port int    `yaml:"port"`
	Host string `yaml:"host"`
	// AllowedOrigins is the CORS allowlist. Empty means same-origin only.
	AllowedOrigins []string      `yaml:"allowed_origins"`
	ReadTimeout    time.Duration `yaml:"read_timeout"`
	WriteTimeout   time.Duration `yaml:"write_timeout"`
	// ShutdownTimeout bounds how long a graceful shutdown waits for in-flight requests.
	// An order being committed must not be killed mid-transaction on a deploy.
	ShutdownTimeout time.Duration `yaml:"shutdown_timeout"`
	// TrustedProxies is passed to gin. Left empty, gin trusts every proxy header, which
	// makes the client IP -- and therefore rate limiting -- trivially spoofable.
	TrustedProxies []string `yaml:"trusted_proxies"`
	// RateLimitPerMinute bounds per-IP requests on public diner routes. Zero disables it.
	RateLimitPerMinute int `yaml:"rate_limit_per_minute"`
}

// DatabaseConfig holds connection settings.
type DatabaseConfig struct {
	// Driver is postgres in every real environment; sqlite exists for tests.
	Driver   string `yaml:"driver"`
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
	User     string `yaml:"user"`
	Password string `yaml:"password"`
	Name     string `yaml:"name"`
	SSLMode  string `yaml:"ssl_mode"`
	// DSN, when set, overrides every field above. Managed hosts hand out one URL.
	DSN             string        `yaml:"dsn"`
	MaxOpenConns    int           `yaml:"max_open_conns"`
	MaxIdleConns    int           `yaml:"max_idle_conns"`
	ConnMaxLifetime time.Duration `yaml:"conn_max_lifetime"`
	// LogQueries emits every statement. Local debugging only -- it logs parameters.
	LogQueries bool `yaml:"log_queries"`
}

// AuthConfig holds staff JWT settings.
type AuthConfig struct {
	// JWTSecret has no default on purpose. Startup fails without it rather than falling
	// back to a hard-coded value that would ship to production and forge any staff token.
	JWTSecret string `yaml:"jwt_secret"`
	// AccessTokenTTL is short: a stolen token expires on its own.
	AccessTokenTTL time.Duration `yaml:"access_token_ttl"`
	// RefreshTokenTTL spans a shift, so a tablet on the floor is not re-authenticating
	// during dinner service.
	RefreshTokenTTL time.Duration `yaml:"refresh_token_ttl"`
	// BcryptCost is the password hashing work factor.
	BcryptCost int `yaml:"bcrypt_cost"`
}

// GuestConfig holds anonymous diner session settings (DECISIONS.md D5).
type GuestConfig struct {
	// SessionTTL must outlast a meal: expiring mid-sitting takes away the order-tracking
	// screen the diner was promised.
	SessionTTL time.Duration `yaml:"session_ttl"`
	// MaxItemsPerOrder bounds a single cart, so a crafted request cannot tie up a
	// transaction with tens of thousands of lines.
	MaxItemsPerOrder int `yaml:"max_items_per_order"`
	// MaxQuantityPerItem bounds one line.
	MaxQuantityPerItem int `yaml:"max_quantity_per_item"`
}

// PaymentsConfig selects and configures the payment provider (DECISIONS.md D2).
type PaymentsConfig struct {
	// DefaultProvider is used by restaurants that have not chosen one.
	DefaultProvider string         `yaml:"default_provider"`
	Razorpay        RazorpayConfig `yaml:"razorpay"`
	// UPIStaticNote is the template for the UPI transaction note. {{ref}} and {{order}}
	// are substituted.
	UPIStaticNote string `yaml:"upi_static_note"`
}

// RazorpayConfig holds gateway credentials. Absent credentials disable the provider
// rather than failing startup -- most restaurants run on static UPI.
type RazorpayConfig struct {
	KeyID         string `yaml:"key_id"`
	KeySecret     string `yaml:"key_secret"`
	WebhookSecret string `yaml:"webhook_secret"`
	BaseURL       string `yaml:"base_url"`
}

// RealtimeConfig holds WebSocket hub settings (DECISIONS.md D10).
type RealtimeConfig struct {
	Enabled      bool          `yaml:"enabled"`
	PingInterval time.Duration `yaml:"ping_interval"`
	PongWait     time.Duration `yaml:"pong_wait"`
	WriteWait    time.Duration `yaml:"write_wait"`
	// SendBufferSize bounds each connection's outbound queue. A slow consumer is dropped
	// rather than allowed to grow a queue until the process runs out of memory.
	SendBufferSize int `yaml:"send_buffer_size"`
}

// LogConfig holds logger settings.
type LogConfig struct {
	Level  string `yaml:"level"`
	Format string `yaml:"format"`
}

// Defaults returns a Config with every safe default filled in. Only secrets and the
// public base URLs are left empty.
func Defaults() *Config {
	return &Config{
		App: AppConfig{
			Name: "tablex",
			Env:  "local",
		},
		Server: ServerConfig{
			Port:               8080,
			Host:               "0.0.0.0",
			ReadTimeout:        15 * time.Second,
			WriteTimeout:       30 * time.Second,
			ShutdownTimeout:    20 * time.Second,
			RateLimitPerMinute: 120,
		},
		Database: DatabaseConfig{
			Driver:          "postgres",
			Host:            "127.0.0.1",
			Port:            5434,
			User:            "postgres",
			Password:        "postgres",
			Name:            "tablex",
			SSLMode:         "disable",
			MaxOpenConns:    25,
			MaxIdleConns:    5,
			ConnMaxLifetime: time.Hour,
		},
		Auth: AuthConfig{
			AccessTokenTTL:  2 * time.Hour,
			RefreshTokenTTL: 12 * time.Hour,
			BcryptCost:      12,
		},
		Guest: GuestConfig{
			SessionTTL:         12 * time.Hour,
			MaxItemsPerOrder:   50,
			MaxQuantityPerItem: 99,
		},
		Payments: PaymentsConfig{
			DefaultProvider: "upi_static",
			UPIStaticNote:   "Order {{order}} ref {{ref}}",
			Razorpay:        RazorpayConfig{BaseURL: "https://api.razorpay.com/v1"},
		},
		Realtime: RealtimeConfig{
			Enabled:        true,
			PingInterval:   30 * time.Second,
			PongWait:       60 * time.Second,
			WriteWait:      10 * time.Second,
			SendBufferSize: 64,
		},
		Log: LogConfig{Level: "info", Format: "text"},
	}
}

// Load reads defaults, then the YAML file at path if it is non-empty, then the
// environment, and validates the result.
func Load(path string) (*Config, error) {
	cfg := Defaults()

	if path != "" {
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("config: read %s: %w", path, err)
		}
		if err := yaml.Unmarshal(raw, cfg); err != nil {
			return nil, fmt.Errorf("config: parse %s: %w", path, err)
		}
	}

	cfg.applyEnv()

	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// applyEnv overlays TABLEX_-prefixed environment variables.
func (c *Config) applyEnv() {
	envStr("TABLEX_ENV", &c.App.Env)
	envStr("TABLEX_DINER_BASE_URL", &c.App.DinerBaseURL)
	envStr("TABLEX_ADMIN_BASE_URL", &c.App.AdminBaseURL)

	envInt("TABLEX_PORT", &c.Server.Port)
	envStr("TABLEX_HOST", &c.Server.Host)
	envInt("TABLEX_RATE_LIMIT_PER_MINUTE", &c.Server.RateLimitPerMinute)
	if v := os.Getenv("TABLEX_ALLOWED_ORIGINS"); v != "" {
		c.Server.AllowedOrigins = splitAndTrim(v)
	}
	if v := os.Getenv("TABLEX_TRUSTED_PROXIES"); v != "" {
		c.Server.TrustedProxies = splitAndTrim(v)
	}

	envStr("TABLEX_DB_DRIVER", &c.Database.Driver)
	envStr("TABLEX_DB_HOST", &c.Database.Host)
	envInt("TABLEX_DB_PORT", &c.Database.Port)
	envStr("TABLEX_DB_USER", &c.Database.User)
	envStr("TABLEX_DB_PASSWORD", &c.Database.Password)
	envStr("TABLEX_DB_NAME", &c.Database.Name)
	envStr("TABLEX_DB_SSLMODE", &c.Database.SSLMode)
	envStr("TABLEX_DB_DSN", &c.Database.DSN)
	// Also accept DATABASE_URL, which is what managed Postgres hosts inject by default.
	if v := os.Getenv("DATABASE_URL"); v != "" && c.Database.DSN == "" {
		c.Database.DSN = v
	}
	envBool("TABLEX_DB_LOG_QUERIES", &c.Database.LogQueries)

	envStr("TABLEX_JWT_SECRET", &c.Auth.JWTSecret)
	envDuration("TABLEX_ACCESS_TOKEN_TTL", &c.Auth.AccessTokenTTL)
	envDuration("TABLEX_REFRESH_TOKEN_TTL", &c.Auth.RefreshTokenTTL)
	envInt("TABLEX_BCRYPT_COST", &c.Auth.BcryptCost)

	envDuration("TABLEX_GUEST_SESSION_TTL", &c.Guest.SessionTTL)

	envStr("TABLEX_PAYMENT_PROVIDER", &c.Payments.DefaultProvider)
	envStr("TABLEX_RAZORPAY_KEY_ID", &c.Payments.Razorpay.KeyID)
	envStr("TABLEX_RAZORPAY_KEY_SECRET", &c.Payments.Razorpay.KeySecret)
	envStr("TABLEX_RAZORPAY_WEBHOOK_SECRET", &c.Payments.Razorpay.WebhookSecret)

	envBool("TABLEX_REALTIME_ENABLED", &c.Realtime.Enabled)

	envStr("TABLEX_LOG_LEVEL", &c.Log.Level)
	envStr("TABLEX_LOG_FORMAT", &c.Log.Format)
}

// Validate rejects a configuration that would fail confusingly at runtime.
//
// Everything checked here is something that produces either a security hole or a batch of
// wrongly-printed QR codes, and both are much cheaper to catch at boot.
func (c *Config) Validate() error {
	var problems []string

	if c.Auth.JWTSecret == "" {
		problems = append(problems, "auth.jwt_secret is required (set TABLEX_JWT_SECRET)")
	} else if len(c.Auth.JWTSecret) < 32 && c.IsProduction() {
		problems = append(problems, "auth.jwt_secret must be at least 32 characters in production")
	}

	if c.App.DinerBaseURL == "" {
		problems = append(problems, "app.diner_base_url is required (it is encoded into every table QR code)")
	} else if !strings.HasPrefix(c.App.DinerBaseURL, "http://") && !strings.HasPrefix(c.App.DinerBaseURL, "https://") {
		problems = append(problems, "app.diner_base_url must include a scheme, e.g. https://order.example.com")
	}

	if c.Database.Driver != "postgres" && c.Database.Driver != "sqlite" {
		problems = append(problems, fmt.Sprintf("database.driver %q is not supported (want postgres or sqlite)", c.Database.Driver))
	}
	if c.Server.Port <= 0 || c.Server.Port > 65535 {
		problems = append(problems, fmt.Sprintf("server.port %d is out of range", c.Server.Port))
	}
	if c.Auth.BcryptCost < 10 || c.Auth.BcryptCost > 15 {
		problems = append(problems, fmt.Sprintf("auth.bcrypt_cost %d is out of range (want 10-15)", c.Auth.BcryptCost))
	}
	if c.Guest.SessionTTL <= 0 {
		problems = append(problems, "guest.session_ttl must be positive")
	}
	if c.Guest.MaxItemsPerOrder <= 0 {
		problems = append(problems, "guest.max_items_per_order must be positive")
	}
	if c.Guest.MaxQuantityPerItem <= 0 {
		problems = append(problems, "guest.max_quantity_per_item must be positive")
	}

	// A production deployment that trusts every proxy header has a spoofable client IP,
	// which silently defeats the rate limiter.
	if c.IsProduction() && len(c.Server.TrustedProxies) == 0 {
		problems = append(problems, "server.trusted_proxies must be set in production")
	}

	if len(problems) > 0 {
		return fmt.Errorf("config: invalid configuration:\n  - %s", strings.Join(problems, "\n  - "))
	}
	return nil
}

// IsProduction reports whether this is a production deployment.
func (c *Config) IsProduction() bool { return strings.EqualFold(c.App.Env, "production") }

// IsLocal reports whether this is a local development run.
func (c *Config) IsLocal() bool { return strings.EqualFold(c.App.Env, "local") }

// PostgresDSN builds the connection string, preferring an explicit DSN.
func (c *DatabaseConfig) PostgresDSN() string {
	if c.DSN != "" {
		return c.DSN
	}
	sslMode := c.SSLMode
	if sslMode == "" {
		sslMode = "disable"
	}
	return fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		c.Host, c.Port, c.User, c.Password, c.Name, sslMode)
}

// Addr is the listener address for the HTTP server.
func (c *ServerConfig) Addr() string { return fmt.Sprintf("%s:%d", c.Host, c.Port) }

func envStr(key string, dst *string) {
	if v := os.Getenv(key); v != "" {
		*dst = v
	}
}

func envInt(key string, dst *int) {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			*dst = n
		}
	}
}

func envBool(key string, dst *bool) {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			*dst = b
		}
	}
}

func envDuration(key string, dst *time.Duration) {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			*dst = d
		}
	}
}

func splitAndTrim(v string) []string {
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if s := strings.TrimSpace(p); s != "" {
			out = append(out, s)
		}
	}
	return out
}
