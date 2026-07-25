package handlers

import (
	"io"
	"log/slog"
	"net/http"

	"github.com/glimesh/broadcast-box/internal/environment"
	"github.com/glimesh/broadcast-box/internal/server/helpers"
)

func logHandler(responseWriter http.ResponseWriter, request *http.Request) {
	if !environment.IsLoggingAPIEnabled() {
		return
	}

	if apiKey := environment.GetLoggingAPIKey(); apiKey != "" {
		authHeader := request.Header.Get("Authorization")
		token := helpers.ResolveBearerToken(authHeader)

		if token == "" {
			helpers.LogHTTPError(responseWriter, "Authorization was invalid", http.StatusUnauthorized)

			return
		} else if token != apiKey {
			helpers.LogHTTPError(responseWriter, "Authorization was invalid", http.StatusUnauthorized)

			return
		}
	}

	file, err := environment.GetLogFileReader()
	if err != nil {
		slog.Error("API.Log Error", "err", err)
	}

	responseWriter.Header().Set("Content-Type", "text/plain")

	if _, err := io.Copy(responseWriter, file); err != nil {
		slog.Error("API.Log: Error writing file to response", "err", err)
		helpers.LogHTTPError(responseWriter, "Invalid request", http.StatusBadRequest)
	}

	err = file.Close()
	if err != nil {
		slog.Error("API.Log Error", "err", err)
	}
}
