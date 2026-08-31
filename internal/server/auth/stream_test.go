package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/glimesh/broadcast-box/internal/environment"
)

// setPasswords configures the umbrella and the two overrides together, since
// the effective values are resolved from all three at snapshot time.
func setPasswords(t *testing.T, umbrella string, site string, stream string) {
	t.Helper()

	t.Cleanup(environment.ResolveEnvironmentVariables)
	t.Setenv(environment.Password, umbrella)
	t.Setenv(environment.SitePassword, site)
	t.Setenv(environment.StreamPassword, stream)
	environment.ResolveEnvironmentVariables()
}

func TestSplitStreamCredentials(t *testing.T) {
	tests := []struct {
		name        string
		token       string
		password    string
		streamKey   string
		hasPassword bool
	}{
		{
			name:        "password and key",
			token:       "hunter2:my-stream",
			password:    "hunter2",
			streamKey:   "my-stream",
			hasPassword: true,
		},
		{
			// Split on the last separator, so a password may contain colons.
			name:        "password containing a colon",
			token:       "correct:horse:my-stream",
			password:    "correct:horse",
			streamKey:   "my-stream",
			hasPassword: true,
		},
		{
			name:        "no separator is the bare stream key",
			token:       "my-stream",
			password:    "",
			streamKey:   "my-stream",
			hasPassword: false,
		},
		{
			name:        "empty password",
			token:       ":my-stream",
			password:    "",
			streamKey:   "my-stream",
			hasPassword: true,
		},
		{
			name:        "empty stream key",
			token:       "hunter2:",
			password:    "hunter2",
			streamKey:   "",
			hasPassword: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			password, streamKey, hasPassword := SplitStreamCredentials(test.token)

			if password != test.password || streamKey != test.streamKey || hasPassword != test.hasPassword {
				t.Fatalf("SplitStreamCredentials(%q) = (%q, %q, %v), want (%q, %q, %v)",
					test.token, password, streamKey, hasPassword,
					test.password, test.streamKey, test.hasPassword)
			}
		})
	}
}

// With no password configured a token containing a colon is a stream name, not
// a credential. Reading it as one would silently retarget the stream.
func TestUnconfiguredStreamPasswordPassesTokensThrough(t *testing.T) {
	setPasswords(t, "", "", "")
	resetLimiter(t)

	for _, token := range []string{"my-stream", "looks:like-credentials"} {
		streamKey, ok := AuthorizeStreamToken(token)

		if !ok || streamKey != token {
			t.Fatalf("AuthorizeStreamToken(%q) = (%q, %v), want it passed through", token, streamKey, ok)
		}
	}
}

func TestStreamPasswordAuthorizesAndStripsThePrefix(t *testing.T) {
	setPasswords(t, "", "", "hunter2")
	resetLimiter(t)

	streamKey, ok := AuthorizeStreamToken("hunter2:my-stream")

	if !ok || streamKey != "my-stream" {
		t.Fatalf("AuthorizeStreamToken() = (%q, %v), want (\"my-stream\", true)", streamKey, ok)
	}
}

func TestStreamPasswordRejectsBadTokens(t *testing.T) {
	tests := map[string]string{
		"wrong password":     "wrong:my-stream",
		"no password at all": "my-stream",
		"empty password":     ":my-stream",
		"missing stream key": "hunter2:",
		"password only":      "hunter2",
		"case mismatch":      "HUNTER2:my-stream",
	}

	for name, token := range tests {
		t.Run(name, func(t *testing.T) {
			setPasswords(t, "", "", "hunter2")
			resetLimiter(t)

			if streamKey, ok := AuthorizeStreamToken(token); ok {
				t.Fatalf("AuthorizeStreamToken(%q) = (%q, true), want rejected", token, streamKey)
			}
		})
	}
}

// PASSWORD sets both halves at once.
func TestUmbrellaPasswordCoversBoth(t *testing.T) {
	setPasswords(t, "shared", "", "")
	resetLimiter(t)

	if environment.GetSitePassword() != "shared" {
		t.Fatalf("site password = %q, want it to fall back to PASSWORD", environment.GetSitePassword())
	}

	if streamKey, ok := AuthorizeStreamToken("shared:my-stream"); !ok || streamKey != "my-stream" {
		t.Fatalf("AuthorizeStreamToken() = (%q, %v), want the umbrella password accepted", streamKey, ok)
	}
}

// Either half can be set on its own, overriding the umbrella.
func TestSpecificPasswordsOverrideTheUmbrella(t *testing.T) {
	setPasswords(t, "shared", "site-only", "stream-only")
	resetLimiter(t)

	if environment.GetSitePassword() != "site-only" {
		t.Fatalf("site password = %q, want SITE_PASSWORD to win", environment.GetSitePassword())
	}

	if _, ok := AuthorizeStreamToken("stream-only:my-stream"); !ok {
		t.Fatal("expected STREAM_PASSWORD to win over PASSWORD")
	}

	resetLimiter(t)

	if _, ok := AuthorizeStreamToken("shared:my-stream"); ok {
		t.Fatal("expected the umbrella password to be rejected once STREAM_PASSWORD overrides it")
	}
}

// Only one half configured must not gate the other.
func TestSitePasswordAloneLeavesPublishingOpen(t *testing.T) {
	setPasswords(t, "", "site-only", "")
	resetLimiter(t)

	if IsStreamPasswordEnabled() {
		t.Fatal("expected SITE_PASSWORD alone to leave publishing ungated")
	}

	if streamKey, ok := AuthorizeStreamToken("my-stream"); !ok || streamKey != "my-stream" {
		t.Fatalf("AuthorizeStreamToken() = (%q, %v), want it passed through", streamKey, ok)
	}
}

func TestStreamPasswordAloneLeavesTheSiteOpen(t *testing.T) {
	setPasswords(t, "", "", "stream-only")

	if IsEnabled() {
		t.Fatal("expected STREAM_PASSWORD alone to leave the site ungated")
	}
}

func readStreamPassword(t *testing.T) streamPasswordJSON {
	t.Helper()

	recorder := httptest.NewRecorder()
	StreamPasswordHandler(recorder, httptest.NewRequest(http.MethodGet, "/api/stream-password", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}

	if cache := recorder.Header().Get("Cache-Control"); !strings.Contains(cache, "no-store") {
		t.Fatalf("expected the credential to be uncacheable, got Cache-Control %q", cache)
	}

	var response streamPasswordJSON
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	return response
}

// Someone past the site gate is handed the password, so publishing from the
// browser does not ask for a second secret they cannot read back.
func TestStreamPasswordIsDisclosedBehindTheSiteGate(t *testing.T) {
	setPasswords(t, "", "site-secret", "stream-secret")

	response := readStreamPassword(t)

	if !response.Required || response.Password != "stream-secret" {
		t.Fatalf("got %+v, want the stream password disclosed", response)
	}
}

// The critical guard: with no site password the gate lets everyone through, so
// disclosing here would hand the stream password to the public.
func TestStreamPasswordIsWithheldWithoutASiteGate(t *testing.T) {
	setPasswords(t, "", "", "stream-secret")

	response := readStreamPassword(t)

	if !response.Required {
		t.Fatal("expected the publish page to still be told a password is required")
	}

	if response.Password != "" {
		t.Fatalf("stream password leaked with no site gate in front of it: %q", response.Password)
	}
}

// The umbrella variable gates the site too, so disclosure is safe under it.
func TestUmbrellaPasswordIsDisclosed(t *testing.T) {
	setPasswords(t, "shared", "", "")

	response := readStreamPassword(t)

	if !response.Required || response.Password != "shared" {
		t.Fatalf("got %+v, want the shared password disclosed", response)
	}
}

func TestStreamPasswordReportsWhenNoneIsRequired(t *testing.T) {
	setPasswords(t, "", "site-secret", "")

	response := readStreamPassword(t)

	if response.Required {
		t.Fatal("expected publishing to be reported as ungated")
	}

	if response.Password != "" {
		t.Fatalf("expected no password, got %q", response.Password)
	}
}

func TestStreamPasswordRejectsNonGetMethods(t *testing.T) {
	setPasswords(t, "", "site-secret", "stream-secret")

	recorder := httptest.NewRecorder()
	StreamPasswordHandler(recorder, httptest.NewRequest(http.MethodPost, "/api/stream-password", nil))

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", recorder.Code)
	}
}

// Once throttled the right password must fare no better than a wrong one, or
// an attacker could search straight through the throttle.
func TestThrottlingHidesTheCorrectStreamPassword(t *testing.T) {
	setPasswords(t, "", "", "hunter2")
	resetLimiter(t)

	for range loginBurst {
		AuthorizeStreamToken("wrong:my-stream")
	}

	if _, ok := AuthorizeStreamToken("hunter2:my-stream"); ok {
		t.Fatal("expected the correct password to be refused while throttled")
	}
}
