package auth

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
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
	// PASSWORD would otherwise stand in for an unset SITE_PASSWORD and leave
	// the gate enabled in the tests that expect it inert.
	t.Setenv(environment.Password, "")
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

func TestMissingCredentialsGetThePasswordField(t *testing.T) {
	setPassword(t, "hunter2")
	resetLimiter(t)

	recorder := httptest.NewRecorder()
	reached := false

	Middleware(func(http.ResponseWriter, *http.Request) { reached = true })(recorder, request(nil))

	if reached {
		t.Fatal("expected an unauthenticated request to be refused before the handler")
	}

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected a 401, got %d", recorder.Code)
	}

	// The browser prompt is what this replaced. Leaving the header on would
	// bring it back on top of the form.
	if authenticate := recorder.Header().Get("WWW-Authenticate"); authenticate != "" {
		t.Fatalf("expected no browser prompt, got a challenge %q", authenticate)
	}

	body := recorder.Body.String()

	if !strings.Contains(body, `name="password"`) {
		t.Fatalf("expected the password field, got %q", body)
	}

	// The page is the one thing an unauthenticated visitor can see, so it must
	// give nothing away about what is behind it.
	for _, disclosure := range []string{"Broadcast Box", "/assets/", "stream"} {
		if strings.Contains(body, disclosure) {
			t.Fatalf("expected the page to reveal nothing, found %q", disclosure)
		}
	}
}

// A request carrying no credentials is not an attempt at the password: it is
// someone arriving for the first time. Charging it would let a crawler empty
// the bucket and lock out the people who know the password.
func TestArrivingWithoutCredentialsCostsNoBudget(t *testing.T) {
	setPassword(t, "hunter2")
	resetLimiter(t)

	for range loginBurst * 2 {
		if status, _ := serve(request(nil)); status != http.StatusUnauthorized {
			t.Fatalf("expected the password field, got %d", status)
		}
	}

	if status, reached := serve(withPassword("hunter2")); !reached || status != http.StatusOK {
		t.Fatalf("expected the password to still be accepted, got status %d reached %v", status, reached)
	}
}

// The cookie is what keeps someone logged in across a browser restart, which
// the browser's own credential cache never did.
func TestSessionCookieAuthenticates(t *testing.T) {
	setPassword(t, "hunter2")
	resetLimiter(t)

	recorder := httptest.NewRecorder()
	issueSession(recorder, request(nil))

	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected one cookie, got %d", len(cookies))
	}

	cookie := cookies[0]

	if !cookie.HttpOnly {
		t.Fatal("expected the cookie to be kept away from scripts")
	}

	if cookie.MaxAge < int((24 * time.Hour).Seconds()) {
		t.Fatalf("expected the cookie to outlive the browser session, got max age %d", cookie.MaxAge)
	}

	if strings.Contains(cookie.Value, "hunter2") {
		t.Fatal("expected the cookie to derive from the password rather than carry it")
	}

	authenticated := request(nil)
	authenticated.AddCookie(cookie)

	if status, reached := serve(authenticated); !reached || status != http.StatusOK {
		t.Fatalf("expected the cookie through, got status %d reached %v", status, reached)
	}

	// Rotating the password is the one thing that ends a session, since the
	// token is derived from it and nothing else.
	setPassword(t, "hunter3")

	if status, reached := serve(authenticated); reached || status != http.StatusUnauthorized {
		t.Fatalf("expected a rotated password to end the session, got status %d reached %v", status, reached)
	}
}

// The cookie rides along on every request a page makes, so charging it would
// drain the bucket during ordinary viewing.
func TestSessionCookieCostsNoBudget(t *testing.T) {
	setPassword(t, "hunter2")
	resetLimiter(t)

	recorder := httptest.NewRecorder()
	issueSession(recorder, request(nil))

	authenticated := request(nil)
	authenticated.AddCookie(recorder.Result().Cookies()[0])

	for range loginBurst * 2 {
		if status, reached := serve(authenticated); !reached || status != http.StatusOK {
			t.Fatalf("expected the cookie through, got status %d reached %v", status, reached)
		}
	}

	if status, reached := serve(withPassword("hunter2")); !reached || status != http.StatusOK {
		t.Fatalf("expected the password to still be accepted, got status %d reached %v", status, reached)
	}
}

// A fetch cannot render a login page, and handing one back would only make the
// failure harder to read.
func TestAPIRequestsGetAStatusRatherThanThePage(t *testing.T) {
	setPassword(t, "hunter2")
	resetLimiter(t)

	recorder := httptest.NewRecorder()
	apiRequest := httptest.NewRequest(http.MethodGet, "/api/status", nil)

	Middleware(func(http.ResponseWriter, *http.Request) {})(recorder, apiRequest)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected a 401, got %d", recorder.Code)
	}

	if body := recorder.Body.String(); body != "" {
		t.Fatalf("expected an empty body, got %q", body)
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

// The form is the door most people come through, so the throttle has to cover
// it as well as the credential header.
func TestLoginFormIsThrottled(t *testing.T) {
	setPassword(t, "hunter2")
	resetLimiter(t)

	for attempt := range loginBurst {
		if status := submitPassword(t, "wrong"); status != http.StatusUnauthorized {
			t.Fatalf("expected attempt %d within the burst to be refused, got %d", attempt, status)
		}
	}

	if status := submitPassword(t, "hunter2"); status != http.StatusTooManyRequests {
		t.Fatalf("expected the correct password to be hidden while throttled, got %d", status)
	}
}

func TestLoginFormIssuesASession(t *testing.T) {
	setPassword(t, "hunter2")
	resetLimiter(t)

	recorder := httptest.NewRecorder()
	form := url.Values{"password": {"hunter2"}, "redirect": {"/waLLe"}}
	loginRequest := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(form.Encode()))
	loginRequest.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	LoginHandler(recorder, loginRequest)

	if recorder.Code != http.StatusSeeOther {
		t.Fatalf("expected a redirect after logging in, got %d", recorder.Code)
	}

	if location := recorder.Header().Get("Location"); location != "/waLLe" {
		t.Fatalf("expected to land back on the requested page, got %q", location)
	}

	if len(recorder.Result().Cookies()) != 1 {
		t.Fatal("expected a session cookie")
	}
}

// The redirect comes back through the form, so it is attacker controlled: an
// absolute URL would turn the login into an open redirect.
func TestLoginRedirectStaysOnThisSite(t *testing.T) {
	for _, target := range []string{"https://example.com/", "//example.com/", "example.com"} {
		if redirect := safeRedirect(target); redirect != "/" {
			t.Fatalf("safeRedirect(%q) = %q, want it refused", target, redirect)
		}
	}

	if redirect := safeRedirect("/waLLe?tab=watch"); redirect != "/waLLe?tab=watch" {
		t.Fatalf("expected a rooted path to be kept, got %q", redirect)
	}
}

// submitPassword posts the login form and reports the status.
func submitPassword(t *testing.T, password string) int {
	t.Helper()

	form := url.Values{"password": {password}}
	loginRequest := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(form.Encode()))
	loginRequest.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	recorder := httptest.NewRecorder()
	LoginHandler(recorder, loginRequest)

	return recorder.Code
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
