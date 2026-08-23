// Package logger provides the structured logger used across every layer.
//
// The interface mirrors the shape used elsewhere in our services -- Logger.With(ctx)
// returns a context-bound logger, and the entry exposes Infof/Errorf/Warnf/Debugf -- so
// the call idiom is identical, but this implementation carries no external dependency.
//
// Every log line in the application is prefixed with the method that emitted it,
// "[PlaceOrder] ...", which is what makes a production log greppable by operation.
package logger

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
)

// ctxKey is the private key type for values this package reads out of a context.
type ctxKey string

const (
	// CtxKeyRequestID correlates every line emitted while serving one HTTP request.
	CtxKeyRequestID ctxKey = "request_id"
	// CtxKeyRestaurantID scopes a line to a tenant, so one restaurant's traffic can be
	// isolated from another's in a shared log stream.
	CtxKeyRestaurantID ctxKey = "restaurant_id"
	// CtxKeyActor identifies who caused the line: a staff uid, a guest uid, or "system".
	CtxKeyActor ctxKey = "actor"
)

// Entry is a logger already bound to a request's context values.
type Entry interface {
	Debugf(format string, args ...any)
	Infof(format string, args ...any)
	Warnf(format string, args ...any)
	Errorf(format string, args ...any)
}

// Logger hands out context-bound entries.
type Logger interface {
	With(ctx context.Context) Entry
}

type logger struct {
	base *slog.Logger
}

type entry struct {
	base *slog.Logger
	ctx  context.Context
}

// New builds a Logger writing to w. Format "json" emits structured output for log
// aggregation; anything else emits human-readable text for local development.
func New(w io.Writer, level string, format string) Logger {
	opts := &slog.HandlerOptions{Level: parseLevel(level)}

	var h slog.Handler
	if strings.EqualFold(format, "json") {
		h = slog.NewJSONHandler(w, opts)
	} else {
		h = slog.NewTextHandler(w, opts)
	}
	return &logger{base: slog.New(h)}
}

// Default is the logger used before configuration is loaded, and by tests that do not
// care about output.
func Default() Logger { return New(os.Stdout, "info", "text") }

// Discard drops every line. Used by tests that assert on behaviour, not logs.
func Discard() Logger { return New(io.Discard, "error", "text") }

func parseLevel(level string) slog.Level {
	switch strings.ToLower(level) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func (l *logger) With(ctx context.Context) Entry {
	if ctx == nil {
		ctx = context.Background()
	}
	return &entry{base: l.base, ctx: ctx}
}

// attrs lifts the correlation values out of the context onto the log record. Absent
// values are omitted rather than logged as empty, to keep lines readable.
func (e *entry) attrs() []any {
	out := make([]any, 0, 6)
	for _, k := range []ctxKey{CtxKeyRequestID, CtxKeyRestaurantID, CtxKeyActor} {
		if v := e.ctx.Value(k); v != nil {
			if s, ok := v.(string); !ok || s != "" {
				out = append(out, string(k), v)
			}
		}
	}
	return out
}

func (e *entry) Debugf(format string, args ...any) {
	e.base.DebugContext(e.ctx, fmt.Sprintf(format, args...), e.attrs()...)
}

func (e *entry) Infof(format string, args ...any) {
	e.base.InfoContext(e.ctx, fmt.Sprintf(format, args...), e.attrs()...)
}

func (e *entry) Warnf(format string, args ...any) {
	e.base.WarnContext(e.ctx, fmt.Sprintf(format, args...), e.attrs()...)
}

func (e *entry) Errorf(format string, args ...any) {
	e.base.ErrorContext(e.ctx, fmt.Sprintf(format, args...), e.attrs()...)
}

// WithRequestID returns a context carrying the request correlation id.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, CtxKeyRequestID, id)
}

// WithRestaurantID returns a context carrying the tenant scope.
func WithRestaurantID(ctx context.Context, id int32) context.Context {
	return context.WithValue(ctx, CtxKeyRestaurantID, id)
}

// WithActor returns a context carrying the acting principal's identifier.
func WithActor(ctx context.Context, actor string) context.Context {
	return context.WithValue(ctx, CtxKeyActor, actor)
}
