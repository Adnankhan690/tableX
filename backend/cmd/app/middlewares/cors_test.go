package middlewares

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"tablex/internal/config"
	"tablex/internal/logger"
)

// CORS is the one middleware whose failures are invisible from the server side.
//
// A browser preflight names the headers the real request intends to send, and any header it is
// not granted makes the browser block the request *before it is issued* -- so there is no log
// line, no status code, and nothing in the access log. It also cannot be reproduced with curl,
// which does not preflight at all. That combination is why this is tested rather than eyeballed:
// adding a header to the request path and forgetting the allowlist is a silent, browser-only
// break, and it has happened once already (X-Platform-Token).

const testOrigin = "http://localhost:3001"

func newCORSRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)

	cfg := config.Defaults()
	cfg.Server.AllowedOrigins = []string{"http://localhost:3000", testOrigin}

	mws := New(cfg, logger.New(io.Discard, "error", "text"), nil)
	t.Cleanup(mws.Close)

	engine := gin.New()
	engine.Use(mws.CORS())
	engine.POST("/api/platform/v1/restaurants", func(ctx *gin.Context) { ctx.Status(http.StatusCreated) })
	return engine
}

// preflight issues the OPTIONS request a browser sends before a JSON POST carrying custom headers.
func preflight(engine *gin.Engine, origin, requestHeaders string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodOptions, "/api/platform/v1/restaurants", nil)
	req.Header.Set("Origin", origin)
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", requestHeaders)

	rec := httptest.NewRecorder()
	engine.ServeHTTP(rec, req)
	return rec
}

// TestCORSAllowsEveryHeaderTheAPIReads is the guard that matters.
//
// It is written against the header *constants* rather than string literals, so a new entry in
// middlewares.go that is not added to the allowlist fails here instead of in someone's browser.
func TestCORSAllowsEveryHeaderTheAPIReads(t *testing.T) {
	engine := newCORSRouter(t)

	// Every custom request header this API reads. X-Request-ID is included because a client may
	// supply its own for correlation.
	readByTheAPI := []string{
		HeaderGuestToken,
		HeaderIdempotencyKey,
		HeaderRequestID,
		HeaderPlatformToken,
		HeaderAuthorization,
	}

	rec := preflight(engine, testOrigin, strings.Join(readByTheAPI, ", "))

	granted := rec.Header().Get("Access-Control-Allow-Headers")
	if granted == "" {
		t.Fatal("preflight granted no headers at all")
	}

	for _, header := range readByTheAPI {
		// Case-insensitive: HTTP header names are, and browsers lowercase them in the preflight.
		if !strings.Contains(strings.ToLower(granted), strings.ToLower(header)) {
			t.Errorf("%s is read by the API but not in Access-Control-Allow-Headers (%q) -- "+
				"a browser will block every request that sends it, with no server-side trace",
				header, granted)
		}
	}
}

func TestCORSPreflightSucceedsForTheOnboardingRequest(t *testing.T) {
	// The exact preflight Chrome sends for the admin panel's onboarding POST: a JSON body plus
	// the platform token.
	engine := newCORSRouter(t)

	rec := preflight(engine, testOrigin, "content-type,x-platform-token")

	if rec.Code != http.StatusNoContent {
		t.Fatalf("preflight status %d, want 204", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != testOrigin {
		t.Errorf("Allow-Origin = %q, want %q", got, testOrigin)
	}
	if got := rec.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(got, http.MethodPost) {
		t.Errorf("Allow-Methods = %q, does not permit POST", got)
	}
}

func TestCORSEchoesTheOriginRatherThanAWildcard(t *testing.T) {
	// A wildcard Allow-Origin is invalid on a credentialed request -- the browser rejects the
	// response -- and both frontends send a token on nearly every call.
	engine := newCORSRouter(t)

	rec := preflight(engine, testOrigin, "content-type")

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got == "*" {
		t.Fatal("Allow-Origin is a wildcard, which a credentialed request cannot use")
	}
	// Responses differ by origin, so a shared cache must not serve one origin's to another.
	if got := rec.Header().Get("Vary"); !strings.Contains(got, "Origin") {
		t.Errorf("Vary = %q, want it to include Origin", got)
	}
}

func TestCORSRefusesAnUnlistedOrigin(t *testing.T) {
	engine := newCORSRouter(t)

	rec := preflight(engine, "https://evil.example.com", "content-type,x-platform-token")

	// No Allow-Origin header at all, rather than one naming the caller: without it the browser
	// refuses to hand the response to the page, which is the entire mechanism.
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("an unlisted origin was granted access: %q", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Headers"); got != "" {
		t.Errorf("an unlisted origin was granted headers: %q", got)
	}
}
