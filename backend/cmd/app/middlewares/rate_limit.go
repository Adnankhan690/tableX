package middlewares

import (
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"tablex/internal/response"
)

// sweepInterval is how often stale per-IP buckets are discarded.
//
// The sweep is not optional. A map keyed by client IP with no eviction is an unbounded
// allocation driven by unauthenticated traffic -- a scan from a few thousand addresses turns
// a rate limiter into an out-of-memory kill. Lazy eviction on access would not help, because
// the addresses that fill the map are exactly the ones that never come back.
const sweepInterval = 5 * time.Minute

// bucket is one client's fixed-window counter.
type bucket struct {
	count    int
	windowAt time.Time
}

// rateLimiter is an in-process fixed-window limiter.
//
// A fixed window rather than a token bucket because the failure it guards is a scripted flood
// against the public QR-scan route, not bursty-but-legitimate traffic that a bucket would
// smooth. Simpler, and the burst it permits at a window boundary is irrelevant at this
// threshold.
//
// It counts PER INSTANCE. Behind two replicas the effective limit is doubled -- see the
// README's known limitations. Redis is in docker-compose under the optional profile for
// when that matters.
type rateLimiter struct {
	perMinute int

	mu      sync.Mutex
	buckets map[string]*bucket

	stop chan struct{}
	once sync.Once
}

func newRateLimiter(perMinute int) *rateLimiter {
	limiter := &rateLimiter{
		perMinute: perMinute,
		buckets:   make(map[string]*bucket),
		stop:      make(chan struct{}),
	}

	// Zero disables the limiter entirely, so there is nothing to sweep.
	if perMinute > 0 {
		go limiter.sweep()
	}
	return limiter
}

func (l *rateLimiter) sweep() {
	ticker := time.NewTicker(sweepInterval)
	defer ticker.Stop()

	for {
		select {
		case <-l.stop:
			return
		case <-ticker.C:
			cutoff := time.Now().Add(-2 * time.Minute)
			l.mu.Lock()
			for key, b := range l.buckets {
				if b.windowAt.Before(cutoff) {
					delete(l.buckets, key)
				}
			}
			l.mu.Unlock()
		}
	}
}

func (l *rateLimiter) close() {
	l.once.Do(func() { close(l.stop) })
}

// allow reports whether this client may proceed, and counts the request.
func (l *rateLimiter) allow(key string) bool {
	if l.perMinute <= 0 {
		return true
	}

	now := time.Now()
	windowStart := now.Truncate(time.Minute)

	l.mu.Lock()
	defer l.mu.Unlock()

	b, exists := l.buckets[key]
	if !exists || b.windowAt.Before(windowStart) {
		l.buckets[key] = &bucket{count: 1, windowAt: windowStart}
		return true
	}

	if b.count >= l.perMinute {
		return false
	}
	b.count++
	return true
}

// RateLimit throttles the public diner routes per client IP.
//
// ClientIP is only trustworthy when trusted proxies are configured, which config.Validate
// requires in production for exactly this reason: without it the header is spoofable and the
// limiter counts an attacker's invented addresses instead of their real one.
func (m *Middlewares) RateLimit() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		if !m.rateLimiter.allow(ctx.ClientIP()) {
			m.logger.With(ctx.Request.Context()).Warnf(
				"[RateLimit] %s throttled on %s", ctx.ClientIP(), ctx.Request.URL.Path)
			response.Send(ctx, nil, response.ErrRateLimited)
			return
		}
		ctx.Next()
	}
}
