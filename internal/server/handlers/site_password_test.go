package handlers

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/glimesh/broadcast-box/internal/environment"
)

// gatedHandler builds the real mux with a site password configured, pointed at
// a frontend root so that the asset routes are exercised rather than skipped.
func gatedHandler(t *testing.T, password string) http.HandlerFunc {
	t.Helper()

	// The gate reads the startup snapshot, so it has to be re-taken here and
	// restored once the environment rolls back. Registered before t.Setenv so
	// it runs after it.
	t.Cleanup(environment.ResolveEnvironmentVariables)

	t.Setenv(environment.SitePassword, password)
	t.Setenv(environment.FrontendDisabled, "")
	t.Setenv("FRONTEND_PATH", newFrontendTestRoot(t))

	environment.ResolveEnvironmentVariables()

	return GetServeMuxHandler()
}

func requestPath(t *testing.T, handler http.HandlerFunc, method string, target string) *httptest.ResponseRecorder {
	t.Helper()

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(method, "http://example.com"+target, nil))

	return recorder
}

// The point of gating the assets as well as the API: an unauthenticated
// visitor must not be able to tell what this server is running. They get the
// password field in place of every one of them, and nothing else.
func TestSitePasswordGatesTheFrontend(t *testing.T) {
	handler := gatedHandler(t, "hunter2")

	for _, target := range []string{"/", "/index.html", "/static/app.js", "/some/spa/route"} {
		recorder := requestPath(t, handler, http.MethodGet, target)

		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("expected %s to be refused, got %d", target, recorder.Code)
		}

		body := recorder.Body.String()

		if !strings.Contains(body, `name="password"`) {
			t.Fatalf("expected %s to serve the password field, got %q", target, body)
		}

		if strings.Contains(body, "Broadcast Box") || strings.Contains(body, "/assets/") {
			t.Fatalf("expected %s to reveal nothing of the app, got %q", target, body)
		}
	}
}

// The door cannot be behind the gate it opens.
func TestSitePasswordDoesNotGateTheLoginForm(t *testing.T) {
	handler := gatedHandler(t, "hunter2")

	form := url.Values{"password": {"hunter2"}}
	loginRequest := httptest.NewRequest(
		http.MethodPost, "http://example.com/api/login", strings.NewReader(form.Encode()))
	loginRequest.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, loginRequest)

	if recorder.Code != http.StatusSeeOther {
		t.Fatalf("expected the login to be accepted, got %d", recorder.Code)
	}

	if len(recorder.Result().Cookies()) != 1 {
		t.Fatal("expected a session cookie")
	}
}

func TestSitePasswordGatesTheViewerAPI(t *testing.T) {
	handler := gatedHandler(t, "hunter2")

	for _, target := range []string{"/api/status", "/api/whep", "/api/sse/abc", "/api/layer/abc"} {
		recorder := requestPath(t, handler, http.MethodPost, target)

		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("expected %s to be challenged, got %d", target, recorder.Code)
		}
	}
}

// Publishing cannot carry Basic credentials, so it must reach its own
// authorization rather than the gate. A 401 from the gate and a 401 from WHIP
// look alike, so this asserts on the challenge header, which only the gate
// sets.
func TestSitePasswordDoesNotGatePublishing(t *testing.T) {
	handler := gatedHandler(t, "hunter2")

	for _, target := range []string{"/api/whip", "/api/whip/session-id", "/api/whip/profile"} {
		recorder := requestPath(t, handler, http.MethodPost, target)

		if authenticate := recorder.Header().Get("WWW-Authenticate"); authenticate != "" {
			t.Fatalf("expected %s to bypass the site password gate, got a challenge", target)
		}
	}
}

// The admin API carries FRONTEND_ADMIN_TOKEN as a bearer token and checks it
// itself, so the gate must let it reach that check rather than challenge a
// machine client that has no Basic credentials to send.
func TestSitePasswordDoesNotGateTheAdminAPI(t *testing.T) {
	handler := gatedHandler(t, "hunter2")

	for _, target := range []string{"/api/admin/login", "/api/admin/status", "/api/admin/profiles"} {
		recorder := requestPath(t, handler, http.MethodPost, target)

		if authenticate := recorder.Header().Get("WWW-Authenticate"); authenticate != "" {
			t.Fatalf("expected %s to bypass the site password gate, got a challenge", target)
		}
	}
}

// A route added later must be gated by default, so the gate wraps the mux
// rather than a list of paths. An unmatched path falls through to the frontend
// handler, which is exactly the case a per-route gate would miss.
func TestSitePasswordGatesUnknownPaths(t *testing.T) {
	handler := gatedHandler(t, "hunter2")

	recorder := requestPath(t, handler, http.MethodGet, "/api/not-a-route")

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected an unknown path to be challenged, got %d", recorder.Code)
	}
}

func TestCorrectSitePasswordReachesTheFrontend(t *testing.T) {
	handler := gatedHandler(t, "hunter2")

	request := httptest.NewRequest(http.MethodGet, "http://example.com/static/app.js", nil)
	request.SetBasicAuth("", "hunter2")

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected the asset to be served, got %d", recorder.Code)
	}

	if body := recorder.Body.String(); body != "console.log('app')" {
		t.Fatalf("expected the static file contents, got %q", body)
	}
}

// With no password configured the server must behave exactly as it did before
// the gate existed.
func TestUnconfiguredSitePasswordServesEverything(t *testing.T) {
	handler := gatedHandler(t, "")

	recorder := requestPath(t, handler, http.MethodGet, "/static/app.js")

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected the asset to be served ungated, got %d", recorder.Code)
	}
}
