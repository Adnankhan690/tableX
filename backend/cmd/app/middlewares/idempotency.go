package middlewares

import (
	"github.com/gin-gonic/gin"
)

// maxIdempotencyKeyLen matches the column width in the orders table. A longer value would be
// silently truncated on write, which would make two distinct retries collide.
const maxIdempotencyKeyLen = 128

// Idempotency extracts and validates the Idempotency-Key header.
//
// It only stages the value for the order service; it caches nothing. The deduplication itself
// is a unique index on (restaurant_id, idempotency_key), so it survives a restart and works
// across replicas (DECISIONS.md D12). A response cache here would be a second source of
// truth that agrees with the database only most of the time.
//
// A malformed key is dropped rather than rejected: the order is still perfectly valid without
// one, and failing the request would turn a client's header bug into a diner who cannot order.
func (m *Middlewares) Idempotency() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		key := ctx.GetHeader(HeaderIdempotencyKey)

		if key != "" && validIdempotencyKey(key) {
			ctx.Set(CtxKeyIdempotencyKey, key)
		} else if key != "" {
			m.logger.With(ctx.Request.Context()).Warnf(
				"[Idempotency] ignoring malformed key of length %d", len(key))
		}

		ctx.Next()
	}
}

// validIdempotencyKey accepts printable ASCII within the column width.
//
// Control characters and multi-byte input are refused because this value is logged and used
// as a database key, and neither benefits from accepting arbitrary bytes.
func validIdempotencyKey(key string) bool {
	if len(key) == 0 || len(key) > maxIdempotencyKeyLen {
		return false
	}
	for i := 0; i < len(key); i++ {
		if key[i] < 0x21 || key[i] > 0x7e {
			return false
		}
	}
	return true
}
