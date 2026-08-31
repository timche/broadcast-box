package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"time"
)

// sessionCookieName is deliberately unremarkable. It is the one string an
// unauthenticated visitor can read, the same reasoning that keeps the login
// page unbranded.
const sessionCookieName = "session"

// sessionPurpose keeps the derivation below tied to this one use, so a token
// minted here could never be mistaken for one minted for anything else added
// later.
const sessionPurpose = "broadcast-box site session v1"

// sessionLifetime is "until the password changes" as far as this server is
// concerned. Browsers cap what they honor - Chrome clamps to 400 days - so
// this is an upper bound rather than a promise.
const sessionLifetime = 10 * 365 * 24 * time.Hour

// sessionToken derives the cookie value from the site password.
//
// Deriving rather than storing is what makes the session outlive a restart
// while still ending the moment the password is rotated: the server keeps no
// session list, and a token minted under the old password simply stops
// matching. An HMAC rather than the password itself, so a cookie that leaks
// discloses access but never the password - which matters because the same
// secret is what broadcasters put in front of their stream key.
func sessionToken() string {
	mac := hmac.New(sha256.New, []byte(sitePassword()))
	mac.Write([]byte(sessionPurpose))

	return hex.EncodeToString(mac.Sum(nil))
}

// hasSession reports whether a request carries a cookie minted for the current
// password.
func hasSession(request *http.Request) bool {
	cookie, err := request.Cookie(sessionCookieName)
	if err != nil {
		return false
	}

	// Constant time, like the password comparison it stands in for.
	return hmac.Equal([]byte(cookie.Value), []byte(sessionToken()))
}

// issueSession sets the cookie that keeps a viewer logged in.
func issueSession(responseWriter http.ResponseWriter, request *http.Request) {
	http.SetCookie(responseWriter, &http.Cookie{
		Name:  sessionCookieName,
		Value: sessionToken(),
		Path:  "/",
		// The cookie grants access, so it is kept away from scripts and, where
		// the connection allows it, off plaintext.
		HttpOnly: true,
		Secure:   isSecure(request),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(sessionLifetime.Seconds()),
	})
}

// isSecure reports whether the request reached us over TLS, including the case
// where TLS was terminated at a proxy in front of this server.
//
// X-Forwarded-Proto is set by the client on a direct request, so it is only
// consulted to decide whether to ADD the Secure attribute. A lie costs an
// attacker nothing they did not already have: the worst it does is mark their
// own cookie Secure, and it can never strip the attribute from a real HTTPS
// session, which is set from request.TLS.
func isSecure(request *http.Request) bool {
	return request.TLS != nil || request.Header.Get("X-Forwarded-Proto") == "https"
}
