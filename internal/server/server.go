package server

import (
	"log/slog"
	"os"

	"github.com/glimesh/broadcast-box/internal/environment"
	"github.com/glimesh/broadcast-box/internal/server/auth"
	"github.com/glimesh/broadcast-box/internal/server/handlers"
)

// HTTP Setup
func StartWebServer() {
	setupHTTPRedirect()

	if auth.IsEnabled() {
		slog.Info("Site password is set, viewers must log in before playback")
	}

	serverMux := handlers.GetServeMuxHandler()

	if os.Getenv(environment.SSLKey) != "" && os.Getenv(environment.SSLCert) != "" {
		startHTTPSServer(serverMux)
	} else {
		startHTTPServer(serverMux)
	}
}
