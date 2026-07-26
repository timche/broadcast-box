package server

import (
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/glimesh/broadcast-box/internal/environment"
	"github.com/glimesh/broadcast-box/internal/server/handlers"
)

var (
	defaultHTTPAddress         string = ":8080"
	defaultHTTPRedirectAddress string = ":80"
)

const (
	// Bounds how long a connection may sit having sent nothing but a partial
	// request. Without it a client can hold a connection (and its file
	// descriptor) open indefinitely by dribbling headers, which is the
	// classic Slowloris shape.
	defaultReadHeaderTimeout = 10 * time.Second

	// Requests carry SDP offers and small JSON bodies, never uploads, so a
	// short ceiling on reading the whole request is safe.
	defaultReadTimeout = 30 * time.Second

	// Caps how long an idle keep-alive connection is retained.
	defaultIdleTimeout = 120 * time.Second
)

// Deliberately leaves WriteTimeout unset. It would cap the lifetime of every
// response, and /api/sse streams status events for as long as a viewer is
// connected. sseHandler already applies its own per-write deadline via
// http.ResponseController, which is the correct granularity here.
func applyTimeouts(server *http.Server) *http.Server {
	server.ReadHeaderTimeout = defaultReadHeaderTimeout
	server.ReadTimeout = defaultReadTimeout
	server.IdleTimeout = defaultIdleTimeout

	return server
}

func startHTTPServer(serverMux http.HandlerFunc) {
	server := applyTimeouts(&http.Server{
		Handler: serverMux,
		Addr:    getHTTPAddress(),
	})

	slog.Info("Starting HTTP", "address", getHTTPAddress())
	if err := server.ListenAndServe(); err != nil {
		slog.Error("Server closed with error", "err", err)
		os.Exit(1)
	}
}

func getHTTPAddress() string {
	if httpAddress := os.Getenv(environment.HTTPAddress); httpAddress != "" {
		return httpAddress
	}

	return defaultHTTPAddress
}

func setupHTTPRedirect() {
	if shouldRedirectToHTTPS := os.Getenv(environment.HTTPEnableRedirect); shouldRedirectToHTTPS != "" {
		httpRedirectPort := defaultHTTPRedirectAddress

		if httpRedirectPortEnvVar := os.Getenv(environment.HTTPSRedirectPort); httpRedirectPortEnvVar != "" {
			httpRedirectPort = httpRedirectPortEnvVar
		}

		go func() {
			slog.Info("Setting up HTTP Redirecting")

			redirectServer := applyTimeouts(&http.Server{
				Addr:    httpRedirectPort,
				Handler: http.HandlerFunc(handlers.RedirectToHttpsHandler),
			})

			slog.Info("Forwarding requests to HTTPS server", "address", redirectServer.Addr)
			err := redirectServer.ListenAndServe()

			if err != nil {
				slog.Error("Redirect Server closed with error", "err", err)
				os.Exit(1)
			}
		}()
	}
}
