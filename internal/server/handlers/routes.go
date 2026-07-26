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
	adminHandlers "github.com/glimesh/broadcast-box/internal/server/handlers/admin"
	whipHandlers "github.com/glimesh/broadcast-box/internal/server/handlers/whip"
)

func GetServeMuxHandler() http.HandlerFunc {
	serverMux := http.NewServeMux()

	if os.Getenv(environment.FrontendDisabled) == "" {
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

	// Path middleware
	debugOutputWebRequests := os.Getenv(environment.DebugIncomingAPIRequest)
	handler := http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if strings.EqualFold(debugOutputWebRequests, "TRUE") {
			slog.Info("Calling path", "path", request.URL.Path)
			_, pattern := serverMux.Handler(request)

			if pattern == "" {
				slog.Info("Unmatched path", "path", request.URL.Path)
			} else {
				slog.Info("Found pattern", "pattern", pattern)
			}
		}

		serverMux.ServeHTTP(responseWriter, request)
	})

	return handler
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
