package auth

import (
	"crypto/subtle"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/glimesh/broadcast-box/internal/environment"
	"github.com/glimesh/broadcast-box/internal/server/helpers"
)

// streamCredentialSeparator divides a publisher's password from the stream key
// it is publishing to, as "<password>:<streamKey>".
//
// WHIP gives a broadcaster exactly one field to fill in — OBS calls it the
// stream key — so a password can only reach us by sharing it. A separator is
// the whole of the design for that reason, not because it is elegant.
const streamCredentialSeparator = ":"

// IsStreamPasswordEnabled reports whether publishing requires a password.
func IsStreamPasswordEnabled() bool {
	return environment.GetStreamPassword() != ""
}

// SplitStreamCredentials pulls the password and the stream key out of a
// publisher's token.
//
// The split is on the LAST separator, not the first, so that a password may
// contain colons. The stream key cannot: authorization.isValidStreamKey admits
// only letters, numbers, underscore and dash, which makes the last colon
// unambiguous.
func SplitStreamCredentials(token string) (password string, streamKey string, ok bool) {
	separator := strings.LastIndex(token, streamCredentialSeparator)
	if separator < 0 {
		return "", token, false
	}

	return token[:separator], token[separator+len(streamCredentialSeparator):], true
}

// StreamToken composes the token a publisher sends, carrying the configured
// stream password ahead of the stream key when publishing requires one.
//
// It exists for the callers that publish from inside this process - the startup
// network test - which have no broadcaster to type the password for them.
func StreamToken(streamKey string) string {
	if !IsStreamPasswordEnabled() {
		return streamKey
	}

	return environment.GetStreamPassword() + streamCredentialSeparator + streamKey
}

// AuthorizeStreamToken checks a publisher's token and returns the stream key it
// is publishing to.
//
// With no stream password configured the token is the stream key, exactly as
// before, and any colon in it is left alone: it is a name at that point, not a
// credential, and reading one as the other would silently retarget a stream.
func AuthorizeStreamToken(token string) (streamKey string, ok bool) {
	if !IsStreamPasswordEnabled() {
		return token, true
	}

	if !logins.allow(time.Now()) {
		// Refused without comparing anything, for the reason given on
		// loginLimiter: evaluating while throttled would let an attacker search
		// straight through it.
		return "", false
	}

	password, streamKey, hasPassword := SplitStreamCredentials(token)
	if !hasPassword {
		return "", false
	}

	if subtle.ConstantTimeCompare([]byte(password), []byte(environment.GetStreamPassword())) != 1 {
		return "", false
	}

	// An empty key would otherwise become a stream named "", publishable by
	// anyone who knows the password and findable by nobody.
	if streamKey == "" {
		return "", false
	}

	logins.refund()

	return streamKey, true
}

type streamPasswordJSON struct {
	// Required tells the publish page whether to ask for a password at all.
	Required bool `json:"required"`
	// Password is empty unless the site gate is what let this request in.
	Password string `json:"password"`
}

// StreamPasswordHandler hands the publishing password to someone who has
// already passed the site gate, so that publishing from the browser does not
// ask them for a second secret they have no way of reading back.
//
// The route sits behind Middleware, but that alone is not enough: with no site
// password configured the gate lets everyone through, and this would then serve
// the stream password to the public. So the password is only ever included when
// the site gate is the reason the request arrived here.
func StreamPasswordHandler(responseWriter http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		helpers.LogHTTPError(responseWriter, "Method not allowed", http.StatusMethodNotAllowed)

		return
	}

	response := streamPasswordJSON{Required: IsStreamPasswordEnabled()}

	if IsEnabled() {
		response.Password = environment.GetStreamPassword()
	}

	responseWriter.Header().Set("Content-Type", "application/json")
	// A credential must not sit in a shared cache, nor in the browser's own
	// back/forward cache after the password is rotated.
	responseWriter.Header().Set("Cache-Control", "no-store")

	if err := json.NewEncoder(responseWriter).Encode(response); err != nil {
		slog.Error("API.StreamPassword: Error writing response", "err", err)
	}
}
