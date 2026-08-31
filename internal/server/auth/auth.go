// Package auth gates the site behind a single shared password, using HTTP
// Basic authentication.
//
// The gate lives in the origin rather than at a CDN or reverse proxy on
// purpose. WebRTC media never passes through an HTTP proxy, so the SDP answer
// returned by /api/whep hands every viewer this server's public IP as ICE
// candidates. Anyone who has loaded the site once can therefore reach the
// origin directly and skip an edge-only gate entirely. Enforcing here holds
// however the request arrived.
//
// Basic authentication rather than a login page and a session cookie, because
// the browser draws the prompt itself. Nothing of ours has to be served to an
// unauthenticated visitor: no app shell, no bundle, no route names, not even
// which software this is. A login page would have to be reachable in order to
// be rendered, and would carry all of that with it.
package auth

import (
	"crypto/subtle"
	"net/http"
	"time"

	"github.com/glimesh/broadcast-box/internal/environment"
)

// Browsers print the realm in their password dialog, which makes it the one
// string an unauthenticated visitor can read. It is therefore empty: naming
// the site, or explaining how to log in, would be telling someone who has not
// authenticated something they have no business knowing. People who should be
// here already know what this is and what to type.
//
// The dialog draws a username field regardless and there is no way to suppress
// it; the dialog belongs to the browser. Ignoring the username server-side is
// the closest thing to a password-only prompt that Basic authentication
// allows.
const realm = ""

// IsEnabled reports whether a site password was configured. With no password
// set the gate is inert and every handler behaves as it did before.
func IsEnabled() bool {
	return sitePassword() != ""
}

// The password is compared on every single request, which is exactly the hot
// path environment.ResolveEnvironmentVariables snapshots for.
func sitePassword() string {
	return environment.GetSitePassword()
}

// passwordMatches compares a submitted password in constant time, so the
// comparison itself leaks nothing about how much of a guess was correct.
func passwordMatches(submitted string) bool {
	configured := sitePassword()
	if configured == "" {
		return false
	}

	return subtle.ConstantTimeCompare([]byte(submitted), []byte(configured)) == 1
}

// isAuthorized reports whether a request carries the site password.
//
// The username is ignored. There is one shared secret here, not a set of
// accounts, and demanding a particular username would only be a second thing
// for viewers to get wrong; the browser lets them leave it blank.
func isAuthorized(request *http.Request) bool {
	_, password, ok := request.BasicAuth()
	if !ok {
		return false
	}

	return passwordMatches(password)
}

// Middleware refuses a request that does not carry the site password.
//
// It is not applied to publishing. OBS and FFmpeg send the stream key in the
// one Authorization header WHIP gives them, so there is no room left for
// Basic credentials; publishing keeps its own stream key and profile token
// authorization instead. See STREAM_PROFILE_POLICY for tightening that.
func Middleware(next func(responseWriter http.ResponseWriter, request *http.Request)) http.HandlerFunc {
	return func(responseWriter http.ResponseWriter, request *http.Request) {
		if !IsEnabled() {
			next(responseWriter, request)

			return
		}

		if !logins.allow(time.Now()) {
			// Deliberately answered without evaluating the credentials. Were
			// they checked here, an attacker could keep guessing through the
			// throttle and simply watch for the response that differs, which
			// is the search the throttle exists to prevent.
			challenge(responseWriter, http.StatusTooManyRequests)

			return
		}

		if !isAuthorized(request) {
			challenge(responseWriter, http.StatusUnauthorized)

			return
		}

		// A correct password costs nothing. Basic credentials ride along on
		// every request a page makes, so charging them would drain the bucket
		// during ordinary viewing and lock out the people who know it.
		logins.refund()

		next(responseWriter, request)
	}
}

// challenge asks the browser for the password. The body is empty on purpose:
// an error page would be the one piece of our markup an unauthenticated
// visitor could read.
func challenge(responseWriter http.ResponseWriter, status int) {
	responseWriter.Header().Set("WWW-Authenticate", `Basic realm="`+realm+`", charset="UTF-8"`)
	// Without this a cache could serve the challenge, or worse a page fetched
	// with someone else's credentials, to another visitor.
	responseWriter.Header().Set("Cache-Control", "no-store")
	responseWriter.WriteHeader(status)
}
