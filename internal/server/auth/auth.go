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
// A password field and a cookie, rather than the HTTP Basic prompt this
// started as. Basic credentials live in the browser's authentication cache,
// which is cleared when the browser closes, so every restart asked for the
// password again and there was no way to keep anyone logged in. The cookie is
// derived from the password itself, so it survives restarts on both sides and
// stops working the moment the password is rotated.
//
// The cost is that a login page has to be reachable in order to be rendered.
// It is kept to a single unbranded password field served by this server, so
// what an unauthenticated visitor can see is that field and nothing else: no
// app shell, no bundle, no route names, not even which software this is.
//
// Basic credentials are still accepted when they are sent, which keeps scripts
// and monitoring working, but nothing is ever challenged with
// WWW-Authenticate any more - that header is what made browsers draw the
// prompt this replaces.
package auth

import (
	"crypto/subtle"
	"net/http"
	"strings"
	"time"

	"github.com/glimesh/broadcast-box/internal/environment"
)

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

// isAuthorized reports whether a request carries the site password as HTTP
// Basic credentials.
//
// The username is ignored. There is one shared secret here, not a set of
// accounts, and demanding a particular username would only be a second thing
// to get wrong.
func isAuthorized(request *http.Request) bool {
	_, password, ok := request.BasicAuth()
	if !ok {
		return false
	}

	return passwordMatches(password)
}

// Middleware refuses a request that carries neither a session cookie nor the
// site password.
//
// It is not applied to publishing. OBS and FFmpeg send the stream key in the
// one Authorization header WHIP gives them, so there is no room left for
// credentials of any kind; publishing keeps its own stream key and profile
// token authorization instead. See STREAM_PROFILE_POLICY for tightening that.
func Middleware(next func(responseWriter http.ResponseWriter, request *http.Request)) http.HandlerFunc {
	return func(responseWriter http.ResponseWriter, request *http.Request) {
		if !IsEnabled() {
			next(responseWriter, request)

			return
		}

		// Checked first, and without the throttle: the cookie rides along on
		// every request a page makes, so charging it would drain the bucket
		// during ordinary viewing. It is a 256 bit HMAC, which is not
		// something to guess at rather than something to rate limit.
		if hasSession(request) {
			next(responseWriter, request)

			return
		}

		// Basic credentials still work, for scripts and monitoring. A request
		// that carries none is not an attempt at the password, so it costs
		// nothing and simply gets the password field.
		if _, _, hasCredentials := request.BasicAuth(); !hasCredentials {
			refuse(responseWriter, request, http.StatusUnauthorized)

			return
		}

		if !logins.allow(time.Now()) {
			// Refused without comparing anything. Were the password checked
			// here, an attacker could keep guessing through the throttle and
			// watch for the response that differs, which is the search the
			// throttle exists to prevent.
			refuse(responseWriter, request, http.StatusTooManyRequests)

			return
		}

		if !isAuthorized(request) {
			refuse(responseWriter, request, http.StatusUnauthorized)

			return
		}

		// A correct password costs nothing: credentials ride along on every
		// request a page makes, so charging them would drain the bucket during
		// ordinary viewing and lock out the people who know it.
		logins.refund()

		next(responseWriter, request)
	}
}

// refuse answers a request that arrived without a session.
//
// A page navigation gets the password field, since a person is waiting for
// something to look at. Anything under /api/ gets a bare status: those callers
// are scripts and fetches, and handing them a login page to parse would only
// make a failure harder to read.
func refuse(responseWriter http.ResponseWriter, request *http.Request, status int) {
	// Without this a cache could serve the refusal, or worse a page fetched
	// with someone else's cookie, to another visitor.
	responseWriter.Header().Set("Cache-Control", "no-store")

	if strings.HasPrefix(request.URL.Path, "/api/") {
		responseWriter.WriteHeader(status)

		return
	}

	message := ""
	if status == http.StatusTooManyRequests {
		message = throttledMessage
	}

	writeLoginPage(responseWriter, status, loginPageData{
		Message: message,
		// Back to what they actually asked for once they are in.
		Redirect: safeRedirect(request.URL.RequestURI()),
	})
}
