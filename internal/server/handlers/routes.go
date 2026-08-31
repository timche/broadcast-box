package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/glimesh/broadcast-box/internal/environment"
	"github.com/glimesh/broadcast-box/internal/server/auth"
	adminHandlers "github.com/glimesh/broadcast-box/internal/server/handlers/admin"
	whipHandlers "github.com/glimesh/broadcast-box/internal/server/handlers/whip"
)

func GetServeMuxHandler() http.HandlerFunc {
	serverMux := http.NewServeMux()

	if !environment.IsFrontendDisabled() {
		serverMux.HandleFunc("/", newFrontendHandler(environment.GetFrontendPath()))
	}

	// WHIP/WHEP shared endpoints
	serverMux.HandleFunc("/api/whep", corsHandler(whepHandler))
	serverMux.HandleFunc("/api/whep/", corsHandler(whepHandler))
	serverMux.HandleFunc("/api/sse/", corsHandler(sseHandler))

	// WHIP session endpoints
	serverMux.HandleFunc("/api/whip", corsHandler(whipHandlers.WHIPHandler))
	serverMux.HandleFunc("/api/whip/", corsHandler(whipHandlers.WHIPHandler))
	serverMux.HandleFunc("/api/whip/profile", corsHandler(whipHandlers.ProfileHandler))

	// WHEP session endpoints
	serverMux.HandleFunc("/api/layer/", corsHandler(layerChangeHandler))

	// Publishing password, for browser publishers who are already past the gate.
	serverMux.HandleFunc("/api/stream-password", corsHandler(auth.StreamPasswordHandler))

	// Logging and status endpoints
	serverMux.HandleFunc("/api/log", corsHandler(logHandler))
	serverMux.HandleFunc("/api/status", corsHandler(statusHandler))

	// Admin endpoints
	serverMux.HandleFunc("/api/admin/login", corsHandler(adminHandlers.LoginHandler))
	serverMux.HandleFunc("/api/admin/status", corsHandler(adminHandlers.StatusHandler))
	serverMux.HandleFunc("/api/admin/logging", corsHandler(adminHandlers.LoggingHandler))
	serverMux.HandleFunc("/api/admin/profiles", corsHandler(adminHandlers.ProfilesHandler))
	serverMux.HandleFunc("/api/admin/profiles/reset-token", corsHandler(adminHandlers.ProfilesResetTokenHandler))
	serverMux.HandleFunc("/api/admin/profiles/add-profile", corsHandler(adminHandlers.ProfileAddHandler))
	serverMux.HandleFunc("/api/admin/profiles/remove-profile", corsHandler(adminHandlers.ProfileRemoveHandler))

	// The site password gate wraps the whole mux rather than each route, so a
	// route added later is gated by default. Everything is behind it: the
	// frontend assets as much as the API, so that an unauthenticated visitor
	// cannot even tell what this server is running.
	gatedMux := auth.Middleware(serverMux.ServeHTTP)

	// Path middleware
	debugOutputWebRequests := environment.ShouldDebugIncomingAPIRequest()
	handler := http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if debugOutputWebRequests {
			slog.Info("Calling path", "path", request.URL.Path)
			_, pattern := serverMux.Handler(request)

			if pattern == "" {
				slog.Info("Unmatched path", "path", request.URL.Path)
			} else {
				slog.Info("Found pattern", "pattern", pattern)
			}
		}

		if isPublishPath(request.URL.Path) || isAdminPath(request.URL.Path) {
			serverMux.ServeHTTP(responseWriter, request)

			return
		}

		gatedMux(responseWriter, request)
	})

	return handler
}

// isPublishPath reports whether a request is OBS or FFmpeg publishing a
// stream. WHIP gives a broadcaster one Authorization header and the stream key
// already occupies it, so there is no room left for Basic credentials. These
// paths keep their own stream key and profile token authorization instead; see
// STREAM_PROFILE_POLICY for requiring a reserved token there.
func isPublishPath(requestPath string) bool {
	return requestPath == "/api/whip" || strings.HasPrefix(requestPath, "/api/whip/")
}

// isAdminPath reports whether a request is for the admin API, which carries
// FRONTEND_ADMIN_TOKEN as a bearer token and checks it itself.
//
// The clients here are machines - teamspeak-stream-live polls
// /api/admin/status - and a bearer token leaves no room for Basic credentials
// in the one Authorization header, exactly as it does for publishing. Gating
// these behind the site password as well would mean every machine client held
// two secrets, and would gate a stronger credential behind a weaker shared one.
func isAdminPath(requestPath string) bool {
	return strings.HasPrefix(requestPath, "/api/admin/")
}

func RedirectToHttpsHandler(httpWriter http.ResponseWriter, request *http.Request) {
	http.Redirect(httpWriter, request, "https://"+request.Host+request.URL.String(), http.StatusMovedPermanently)
}

func corsHandler(next func(responseWriter http.ResponseWriter, request *http.Request)) http.HandlerFunc {
	return func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Access-Control-Allow-Origin", "*")
		response.Header().Set("Access-Control-Allow-Methods", "*")
		response.Header().Set("Access-Control-Allow-Headers", "*")
		response.Header().Set("Access-Control-Expose-Headers", "*")

		if request.Method != http.MethodOptions {
			next(response, request)
		}
	}
}

// newFrontendHandler builds the file system and file server once, up front, so
// that they are not reallocated on every request. The returned handler serves
// any file that exists underneath frontendFilePath and falls back to
// index.html for everything else, so that client side routing keeps working.
func newFrontendHandler(frontendFilePath string) http.HandlerFunc {
	fileSystem := http.Dir(frontendFilePath)
	fileServer := http.FileServer(fileSystem)
	indexFilePath := filepath.Join(frontendFilePath, "index.html")

	return func(response http.ResponseWriter, request *http.Request) {
		// http.Dir.Open performs the path containment for us: it cleans the
		// requested path against "/" before joining it to the root, so a
		// traversal attempt such as "/../secret.txt" resolves inside
		// frontendFilePath instead of escaping it. Doing this probe with
		// os.Stat would require replicating that containment by hand.
		file, err := fileSystem.Open(path.Clean(request.URL.Path))
		if err == nil {
			// The probe only cares whether the file exists. Closing it
			// immediately avoids leaking a descriptor per request. Nothing was
			// read from the handle, so a close error carries no information
			// worth acting on or logging per request.
			_ = file.Close()
		}

		if errors.Is(err, os.ErrNotExist) {
			http.ServeFile(response, request, indexFilePath)
		} else {
			fileServer.ServeHTTP(response, request)
		}
	}
}
