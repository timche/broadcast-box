package handlers

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"testing"
)

func newFrontendTestRoot(t *testing.T) string {
	t.Helper()

	root := t.TempDir()

	frontendPath := filepath.Join(root, "build")
	if err := os.Mkdir(frontendPath, 0o755); err != nil {
		t.Fatalf("failed to create frontend directory: %v", err)
	}

	files := map[string]string{
		filepath.Join(frontendPath, "index.html"):       "<html>index</html>",
		filepath.Join(frontendPath, "static", "app.js"): "console.log('app')",
		filepath.Join(root, "secret.txt"):               "TOP SECRET",
	}

	for name, contents := range files {
		if err := os.MkdirAll(filepath.Dir(name), 0o755); err != nil {
			t.Fatalf("failed to create directory for %s: %v", name, err)
		}

		if err := os.WriteFile(name, []byte(contents), 0o644); err != nil {
			t.Fatalf("failed to write %s: %v", name, err)
		}
	}

	return frontendPath
}

func doFrontendRequest(t *testing.T, handler http.HandlerFunc, target string) *httptest.ResponseRecorder {
	t.Helper()

	request := httptest.NewRequest(http.MethodGet, "http://example.com/placeholder", nil)
	request.URL.Path = target

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	return recorder
}

func TestFrontendHandlerServesExistingFile(t *testing.T) {
	handler := newFrontendHandler(newFrontendTestRoot(t))

	recorder := doFrontendRequest(t, handler, "/static/app.js")

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	if body := recorder.Body.String(); body != "console.log('app')" {
		t.Fatalf("expected the static file contents, got %q", body)
	}
}

func TestFrontendHandlerFallsBackToIndexForUnknownPath(t *testing.T) {
	handler := newFrontendHandler(newFrontendTestRoot(t))

	recorder := doFrontendRequest(t, handler, "/some/spa/route")

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	if body := recorder.Body.String(); body != "<html>index</html>" {
		t.Fatalf("expected index.html contents, got %q", body)
	}
}

func TestFrontendHandlerDoesNotServeFilesOutsideRoot(t *testing.T) {
	handler := newFrontendHandler(newFrontendTestRoot(t))

	for _, target := range []string{
		"/../secret.txt",
		"/../../secret.txt",
		"/static/../../secret.txt",
		"/%2e%2e/secret.txt",
	} {
		recorder := doFrontendRequest(t, handler, target)
		body := recorder.Body.String()

		if strings.Contains(body, "TOP SECRET") {
			t.Fatalf("path traversal %q escaped the frontend root: %q", target, body)
		}

		// The traversal is contained inside the root, where nothing matches, so
		// the request either takes the single page app fallback or is refused
		// outright by net/http for containing "..". Either way it must never
		// reach a file outside the root.
		switch {
		case recorder.Code == http.StatusOK && body == "<html>index</html>":
		case recorder.Code == http.StatusBadRequest:
		default:
			t.Fatalf("unexpected response for %q: status %d, body %q", target, recorder.Code, body)
		}
	}
}

func TestFrontendHandlerDoesNotLeakFileDescriptors(t *testing.T) {
	// os.File installs a finalizer that closes the descriptor once the value is
	// collected, which would non-deterministically hide a genuine leak. Disable
	// the garbage collector so the descriptor count reflects only the handler's
	// own book-keeping.
	previousGCPercent := debug.SetGCPercent(-1)
	t.Cleanup(func() { debug.SetGCPercent(previousGCPercent) })

	handler := newFrontendHandler(newFrontendTestRoot(t))

	openFileDescriptors := func() int {
		entries, err := os.ReadDir("/proc/self/fd")
		if err != nil {
			t.Skipf("/proc/self/fd is unavailable on this platform: %v", err)
		}

		return len(entries)
	}

	// Warm up so that any one-off allocations happen before the baseline.
	for i := 0; i < 50; i++ {
		doFrontendRequest(t, handler, "/static/app.js")
		doFrontendRequest(t, handler, "/some/spa/route")
	}

	before := openFileDescriptors()

	for i := 0; i < 500; i++ {
		doFrontendRequest(t, handler, "/static/app.js")
		doFrontendRequest(t, handler, "/some/spa/route")
	}

	after := openFileDescriptors()

	// A small amount of slack for unrelated runtime activity (log files, the
	// test binary's own bookkeeping); a leak would show up as hundreds.
	if after > before+10 {
		t.Fatalf("file descriptors leaked: %d open before requests, %d after", before, after)
	}
}
