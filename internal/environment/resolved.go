package environment

import (
	"os"
	"strings"
)

// Environment variables that are read on request and connection paths are
// resolved once at startup and served from the accessors in this file.
//
// os.Getenv is not free: it takes a lock and linearly scans the process
// environment block. Doing that per request (often with a strings.EqualFold on
// top) is pure overhead for a value that is fixed for the lifetime of the
// process.
//
// The truthiness rules are deliberately NOT unified. Each accessor preserves
// the exact semantics of the call site it replaced:
//   - "isSet" accessors are true for any non-empty value, so DISABLE_STATUS=false
//     still disables the status endpoint.
//   - "isTrue" accessors only accept a case-insensitive "true".
var (
	statusDisabled          bool
	frontendDisabled        bool
	webhookURL              string
	streamProfilePolicy     string
	sitePassword            string
	streamPassword          string
	frontendAdminToken      string
	loggingAPIEnabled       bool
	loggingAPIKey           string
	appendCandidate         string
	stunServers             string
	debugIncomingAPIRequest bool
	debugPrintSSEMessages   bool
	debugPrintOffer         bool
	debugPrintAnswer        bool
)

// ResolveEnvironmentVariables snapshots the environment variables that are read
// on request and connection paths.
//
// It is called by LoadEnvironmentVariables during startup. Tests that change the
// environment after startup (for example with t.Setenv) must call it again for
// the change to be observed, and should register it with t.Cleanup so the
// snapshot is restored once the environment is rolled back.
func ResolveEnvironmentVariables() {
	statusDisabled = isSet(DisableStatus)
	frontendDisabled = isSet(FrontendDisabled)
	webhookURL = os.Getenv(WebhookURL)
	streamProfilePolicy = os.Getenv(StreamProfilePolicy)
	// PASSWORD is the umbrella: it sets both halves, and either can be
	// overridden on its own. Resolving the fallback here rather than at the call
	// sites means every reader sees the effective password and none of them has
	// to know the precedence.
	sitePassword = firstNonEmpty(os.Getenv(SitePassword), os.Getenv(Password))
	streamPassword = firstNonEmpty(os.Getenv(StreamPassword), os.Getenv(Password))
	frontendAdminToken = os.Getenv(FrontendAdminToken)
	loggingAPIEnabled = isTrue(LoggingAPIEnabled)
	loggingAPIKey = os.Getenv(LoggingAPIKey)
	appendCandidate = os.Getenv(AppendCandidate)
	stunServers = os.Getenv(STUNServers)
	debugIncomingAPIRequest = isTrue(DebugIncomingAPIRequest)
	debugPrintSSEMessages = isTrue(DebugPrintSSEMessages)
	debugPrintOffer = isTrue(DebugPrintOffer)
	debugPrintAnswer = isTrue(DebugPrintAnswer)
}

// IsStatusDisabled reports whether DISABLE_STATUS is set to any non-empty value.
func IsStatusDisabled() bool {
	return statusDisabled
}

// IsFrontendDisabled reports whether DISABLE_FRONTEND is set to any non-empty
// value.
func IsFrontendDisabled() bool {
	return frontendDisabled
}

// GetWebhookURL returns WEBHOOK_URL, or an empty string when no webhook is
// configured.
func GetWebhookURL() string {
	return webhookURL
}

// GetStreamProfilePolicy returns STREAM_PROFILE_POLICY verbatim.
func GetStreamProfilePolicy() string {
	return streamProfilePolicy
}

// GetSitePassword returns the password required to view the site: SITE_PASSWORD
// if set, otherwise PASSWORD. Empty when the site is not password protected.
func GetSitePassword() string {
	return sitePassword
}

// GetStreamPassword returns the password required to publish a stream:
// STREAM_PASSWORD if set, otherwise PASSWORD. Empty when publishing is not
// password protected.
func GetStreamPassword() string {
	return streamPassword
}

// GetFrontendAdminToken returns FRONTEND_ADMIN_TOKEN, or an empty string when no
// admin token is configured.
func GetFrontendAdminToken() string {
	return frontendAdminToken
}

// IsLoggingAPIEnabled reports whether LOGGING_API_ENABLED is "true"
// (case-insensitive).
func IsLoggingAPIEnabled() bool {
	return loggingAPIEnabled
}

// GetLoggingAPIKey returns LOGGING_API_KEY, or an empty string when the logging
// API is unauthenticated.
func GetLoggingAPIKey() string {
	return loggingAPIKey
}

// GetAppendCandidate returns APPEND_CANDIDATE, or an empty string when no
// candidate should be appended to answers.
func GetAppendCandidate() string {
	return appendCandidate
}

// GetSTUNServers returns the raw pipe separated STUN_SERVERS value.
func GetSTUNServers() string {
	return stunServers
}

// ShouldDebugIncomingAPIRequest reports whether DEBUG_INCOMING_API_REQUEST is
// "true" (case-insensitive).
func ShouldDebugIncomingAPIRequest() bool {
	return debugIncomingAPIRequest
}

// ShouldDebugPrintSSEMessages reports whether DEBUG_PRINT_SSE_MESSAGES is "true"
// (case-insensitive).
func ShouldDebugPrintSSEMessages() bool {
	return debugPrintSSEMessages
}

// ShouldDebugPrintOffer reports whether DEBUG_PRINT_OFFER is "true"
// (case-insensitive).
func ShouldDebugPrintOffer() bool {
	return debugPrintOffer
}

// ShouldDebugPrintAnswer reports whether DEBUG_PRINT_ANSWER is "true"
// (case-insensitive).
func ShouldDebugPrintAnswer() bool {
	return debugPrintAnswer
}

func isSet(key string) bool {
	return os.Getenv(key) != ""
}

func isTrue(key string) bool {
	return strings.EqualFold(os.Getenv(key), "true")
}

// firstNonEmpty returns the first value that was actually set, so a specific
// variable overrides the umbrella one it falls back to.
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}

	return ""
}
