package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/glimesh/broadcast-box/internal/environment"
)

// The password is served from the startup snapshot, so changing it in a test
// means re-taking that snapshot, and restoring it once the environment rolls
// back. Registered before t.Setenv so it runs after it.
func setPassword(t *testing.T, password string) {
	t.Helper()

	t.Cleanup(environment.ResolveEnvironmentVariables)
	t.Setenv(environment.SitePassword, password)
	environment.ResolveEnvironmentVariables()
}

// Each test gets a full bucket, so one test's failed attempts cannot throttle
// the next.
func resetLimiter(t *testing.T) {
	t.Helper()

	logins.mutex.Lock()
	defer logins.mutex.Unlock()

	logins.tokens = loginBurst
	logins.lastRefill = time.Time{}
}

// request builds a GET carrying the given password as Basic credentials. A nil
// password means no Authorization header at all.
func request(password *string) *http.Request {
	built := httptest.NewRequest(http.MethodGet, "/", nil)

	if password != nil {
		built.SetBasicAuth("", *password)
	}

	return built
}

func withPassword(password string) *http.Request {
	return request(&password)
}

// serve runs the middleware and reports the status and whether the wrapped
// handler was reached.
func serve(builtRequest *http.Request) (status int, reached bool) {
	recorder := httptest.NewRecorder()

	Middleware(func(responseWriter http.ResponseWriter, _ *http.Request) {
		reached = true
		responseWriter.WriteHeader(http.StatusOK)
	})(recorder, builtRequest)

	return recorder.Code, reached
}

func TestIsEnabledFollowsThePassword(t *testing.T) {
	setPassword(t, "")
	if IsEnabled() {
		t.Fatal("expected the gate to be inert with no password set")
	}

	setPassword(t, "hunter2")
	if !IsEnabled() {
		t.Fatal("expected the gate to be enabled with a password set")
	}
}

// With no password configured the server must behave exactly as it did before
// the gate existed, so that upstream deployments are untouched.
func TestUnconfiguredGateLetsEveryRequestThrough(t *testing.T) {
	setPassword(t, "")
	resetLimiter(t)

	status, reached := serve(request(nil))

	if !reached || status != http.StatusOK {
		t.Fatalf("expected the request through, got status %d reached %v", status, reached)
	}
}

func TestCorrectPasswordIsLetThrough(t *testing.T) {
	setPassword(t, "correct horse")
	resetLimiter(t)

	status, reached := serve(withPassword("correct horse"))

	if !reached || status != http.StatusOK {
		t.Fatalf("expected the request through, got status %d reached %v", status, reached)
	}
}

func TestWrongPasswordIsChallenged(t *testing.T) {
	setPassword(t, "correct horse")

	for _, submitted := range []string{"", "correct hors", "correct horse ", "CORRECT HORSE"} {
		resetLimiter(t)

		status, reached := serve(withPassword(submitted))

		if reached {
			t.Fatalf("expected %q to be refused before the handler", submitted)
		}

		if status != http.StatusUnauthorized {
			t.Fatalf("expected %q to be challenged, got status %d", submitted, status)
		}
	}
}

func TestMissingCredentialsAreChallenged(t *testing.T) {
	setPassword(t, "hunter2")
	resetLimiter(t)

	recorder := httptest.NewRecorder()
	reached := false

	Middleware(func(http.ResponseWriter, *http.Request) { reached = true })(recorder, request(nil))

	if reached {
		t.Fatal("expected an unauthenticated request to be refused before the handler")
	}

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected a 401 challenge, got %d", recorder.Code)
	}

	if authenticate := recorder.Header().Get("WWW-Authenticate"); authenticate == "" {
		t.Fatal("expected a WWW-Authenticate header so the browser prompts")
	}

	// The challenge is what an unauthenticated visitor sees, so it must give
	// nothing away about what is behind it.
	if body := recorder.Body.String(); body != "" {
		t.Fatalf("expected an empty challenge body, got %q", body)
	}
}

// The username is not part of the secret, so any of them must work.
func TestUsernameIsIgnored(t *testing.T) {
	setPassword(t, "hunter2")

	for _, username := range []string{"", "viewer", "admin"} {
		resetLimiter(t)

		builtRequest := httptest.NewRequest(http.MethodGet, "/", nil)
		builtRequest.SetBasicAuth(username, "hunter2")

		if status, reached := serve(builtRequest); !reached || status != http.StatusOK {
			t.Fatalf("expected username %q through, got status %d reached %v", username, status, reached)
		}
	}
}

// An empty password disables the gate, so an empty submission must never be
// accepted as one: otherwise a client sending nothing would authenticate.
func TestEmptyPasswordNeverAuthenticates(t *testing.T) {
	setPassword(t, "")

	if passwordMatches("") {
		t.Fatal("expected an empty submission to be rejected when no password is set")
	}
}

func TestRepeatedFailuresAreThrottled(t *testing.T) {
	setPassword(t, "hunter2")
	resetLimiter(t)

	for attempt := range loginBurst {
		if status, _ := serve(withPassword("wrong")); status != http.StatusUnauthorized {
			t.Fatalf("expected attempt %d within the burst to be challenged, got %d", attempt, status)
		}
	}

	status, _ := serve(withPassword("wrong"))
	if status != http.StatusTooManyRequests {
		t.Fatalf("expected the attempt past the burst to be throttled, got %d", status)
	}
}

// Once throttled, the right password must fare no better than a wrong one.
// A correct guess that still got in would let an attacker search straight
// through the throttle.
func TestThrottlingHidesTheCorrectPassword(t *testing.T) {
	setPassword(t, "hunter2")
	resetLimiter(t)

	for range loginBurst {
		serve(withPassword("wrong"))
	}

	status, reached := serve(withPassword("hunter2"))

	if reached {
		t.Fatal("expected the correct password to be refused while throttled")
	}

	if status != http.StatusTooManyRequests {
		t.Fatalf("expected a throttled response, got %d", status)
	}
}

// Basic credentials ride along on every request a page makes. If those spent
// budget, ordinary viewing would throttle the people who know the password.
func TestSuccessfulRequestsDoNotDrainTheBucket(t *testing.T) {
	setPassword(t, "hunter2")
	resetLimiter(t)

	for attempt := range loginBurst * 5 {
		if status, _ := serve(withPassword("hunter2")); status != http.StatusOK {
			t.Fatalf("expected request %d through, got %d", attempt, status)
		}
	}

	if status, _ := serve(withPassword("wrong")); status != http.StatusUnauthorized {
		t.Fatalf("expected budget to remain for a failure, got %d", status)
	}
}

func TestLoginLimiterRefills(t *testing.T) {
	limiter := &loginLimiter{tokens: loginBurst}
	start := time.Now()

	for attempt := range loginBurst {
		if !limiter.allow(start) {
			t.Fatalf("expected attempt %d within the burst to be allowed", attempt)
		}
	}

	if limiter.allow(start) {
		t.Fatal("expected the attempt past the burst to be refused")
	}

	if !limiter.allow(start.Add(loginRefillInterval)) {
		t.Fatal("expected a token to refill after the refill interval")
	}
}

// Idle time must not bank more attempts than the burst allows.
func TestLoginLimiterDoesNotBankTokens(t *testing.T) {
	limiter := &loginLimiter{tokens: 0, lastRefill: time.Now()}
	later := time.Now().Add(time.Hour)

	for attempt := range loginBurst {
		if !limiter.allow(later) {
			t.Fatalf("expected attempt %d to be allowed after a long idle period", attempt)
		}
	}

	if limiter.allow(later) {
		t.Fatal("expected the bucket to cap at the burst size")
	}
}
