package middlewares

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"tablex/internal/config"
	"tablex/internal/logger"
	"tablex/internal/response"
)

// PlatformAuth is the only thing between an anonymous caller and tenant creation
// (DECISIONS.md D14), so its failure modes are asserted rather than assumed. Every case below
// is a way it could fail *open*, which is the only kind of bug that matters here -- failing
// closed is merely inconvenient.
//
// No database and no services: this middleware compares a config value to a header, which is
// exactly why it can be tested this precisely.

const testPlatformToken = "test-platform-token-0123456789abcdef"

// newTestRouter builds a router with PlatformAuth in front of one handler that records
// whether it ran. The bool pointer is the assertion that matters: a middleware that answers
// 401 but calls Next anyway would still have created the restaurant.
func newTestRouter(t *testing.T, configuredToken string) (*gin.Engine, *bool) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	cfg := config.Defaults()
	cfg.Platform.AdminToken = configuredToken

	mws := New(cfg, logger.New(io.Discard, "error", "text"), nil)
	// The rate limiter starts a sweeper goroutine; without this it outlives the test.
	t.Cleanup(mws.Close)

	reached := false
	engine := gin.New()
	engine.POST("/api/platform/v1/restaurants", mws.PlatformAuth(), func(ctx *gin.Context) {
		reached = true
		ctx.Status(http.StatusCreated)
	})

	return engine, &reached
}

// do issues a request and returns the recorder.
func do(engine *gin.Engine, target string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, target, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	engine.ServeHTTP(rec, req)
	return rec
}

// errorCode reads the stable code out of the envelope. Asserting on the code rather than the
// message, as every client is told to: messages are human copy.
func errorCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var envelope response.Envelope
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("response body is not an envelope: %v (%s)", err, rec.Body.String())
	}
	return envelope.Code
}

func TestPlatformAuth_AcceptsTheConfiguredToken(t *testing.T) {
	engine, reached := newTestRouter(t, testPlatformToken)

	rec := do(engine, "/api/platform/v1/restaurants", map[string]string{
		HeaderPlatformToken: testPlatformToken,
	})

	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", rec.Code, rec.Body.String())
	}
	if !*reached {
		t.Fatal("the handler did not run with a correct token")
	}
}

func TestPlatformAuth_AcceptsABearerHeader(t *testing.T) {
	// The fallback exists so a generic HTTP client that only knows how to send bearer tokens
	// can call this. Case-insensitive on the scheme, because clients disagree on the casing.
	for _, header := range []string{
		"Bearer " + testPlatformToken,
		"bearer " + testPlatformToken,
		testPlatformToken, // bare, as staffToken also tolerates
	} {
		engine, reached := newTestRouter(t, testPlatformToken)

		rec := do(engine, "/api/platform/v1/restaurants", map[string]string{
			HeaderAuthorization: header,
		})

		if rec.Code != http.StatusCreated || !*reached {
			t.Errorf("Authorization: %q rejected (status %d)", header, rec.Code)
		}
	}
}

func TestPlatformAuth_RefusesAWrongOrAbsentToken(t *testing.T) {
	cases := map[string]map[string]string{
		"no headers at all":     {},
		"empty header":          {HeaderPlatformToken: ""},
		"wrong token":           {HeaderPlatformToken: "nope"},
		"a staff-looking token": {HeaderAuthorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.x"},
		// A prefix of the real token. This is the case the length check plus the constant-time
		// compare exist for: a naive comparison that returned early would make this
		// measurably faster than a wrong token of the same length, which is how a secret gets
		// guessed one character at a time.
		"a prefix of the real token": {HeaderPlatformToken: testPlatformToken[:len(testPlatformToken)-1]},
		"the real token plus a char": {HeaderPlatformToken: testPlatformToken + "x"},
		// Case matters. The token is a secret, not an identifier.
		"the real token upper-cased": {HeaderPlatformToken: "TEST-PLATFORM-TOKEN-0123456789ABCDEF"},
	}

	for name, headers := range cases {
		engine, reached := newTestRouter(t, testPlatformToken)

		rec := do(engine, "/api/platform/v1/restaurants", headers)

		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: status %d, want 401", name, rec.Code)
		}
		if got := errorCode(t, rec); got != string(response.ErrCodePlatformTokenInvalid) {
			t.Errorf("%s: code %q, want %q", name, got, response.ErrCodePlatformTokenInvalid)
		}
		if *reached {
			t.Errorf("%s: the handler ran anyway -- a restaurant would have been created", name)
		}
	}
}

func TestPlatformAuth_FailsClosedWhenNoTokenIsConfigured(t *testing.T) {
	// The route group is not mounted at all in this state, so reaching here means a wiring bug.
	// The dangerous reading of "configured token is empty" is that an empty header matches it;
	// this asserts the safe one. Both an absent header and a deliberately empty one are tried,
	// because the empty-string comparison is precisely what would succeed.
	for name, headers := range map[string]map[string]string{
		"absent header": {},
		"empty header":  {HeaderPlatformToken: ""},
		"empty bearer":  {HeaderAuthorization: "Bearer "},
	} {
		engine, reached := newTestRouter(t, "")

		rec := do(engine, "/api/platform/v1/restaurants", headers)

		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: status %d, want 401", name, rec.Code)
		}
		if *reached {
			t.Errorf("%s: an unconfigured deployment authorised a tenant-creating call", name)
		}
	}
}

func TestPlatformAuth_IgnoresAQueryStringToken(t *testing.T) {
	// Staff and guest auth accept ?token= on WebSocket upgrades, because a browser WebSocket
	// cannot set headers. Nothing on this surface is a WebSocket, and a tenant-creating secret
	// in a URL ends up in proxy access logs, shell history and Referer headers -- so the
	// fallback must not exist here even though the neighbouring middleware has one.
	engine, reached := newTestRouter(t, testPlatformToken)

	rec := do(engine, "/api/platform/v1/restaurants?token="+testPlatformToken, nil)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401 -- a token in the query string was accepted", rec.Code)
	}
	if *reached {
		t.Fatal("a query-string token authorised a tenant-creating call")
	}
}

func TestPlatformAuth_TrimsSurroundingWhitespace(t *testing.T) {
	// A token pasted out of a terminal or a secrets manager arrives with a newline or a space
	// more often than not, and the resulting 401 is opaque to debug.
	engine, reached := newTestRouter(t, testPlatformToken)

	rec := do(engine, "/api/platform/v1/restaurants", map[string]string{
		HeaderPlatformToken: "  " + testPlatformToken + "  ",
	})

	if rec.Code != http.StatusCreated || !*reached {
		t.Fatalf("a padded token was rejected (status %d)", rec.Code)
	}
}
