package auth

import (
	_ "embed"
	"html/template"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// The page is served by this server rather than by the frontend bundle, and
// carries no name, no branding and no link. A login page has to be reachable
// to be rendered, so it is the one thing an unauthenticated visitor can see;
// everything else - the app shell, the bundle, the route names, the fact that
// this is Broadcast Box - stays behind the gate.
//
//go:embed login.html
var loginPage string

var loginTemplate = template.Must(template.New("login").Parse(loginPage))

type loginPageData struct {
	// Message is the one line above the button. Empty on a first visit.
	Message string
	// Redirect is where to go once the password is accepted.
	Redirect string
}

const (
	wrongPasswordMessage = "Wrong password. Check it and try again."
	throttledMessage     = "Too many attempts. Wait a moment and try again."
)

// LoginHandler takes the password and, if it is right, hands back the cookie.
//
// It is reached without a session by definition, so it is exempt from the gate
// it is the door to. A plain form POST rather than JSON and fetch: the page
// this serves has no script of its own, which is what keeps it something a
// browser can render before any of the bundle is allowed through.
func LoginHandler(responseWriter http.ResponseWriter, request *http.Request) {
	if !IsEnabled() {
		// Nothing to log in to. Sending someone to the site rather than to a
		// password field they cannot satisfy.
		http.Redirect(responseWriter, request, "/", http.StatusSeeOther)

		return
	}

	if request.Method != http.MethodPost {
		writeLoginPage(responseWriter, http.StatusOK, loginPageData{Redirect: "/"})

		return
	}

	if err := request.ParseForm(); err != nil {
		writeLoginPage(responseWriter, http.StatusBadRequest, loginPageData{Redirect: "/"})

		return
	}

	redirect := safeRedirect(request.PostFormValue("redirect"))

	if !logins.allow(time.Now()) {
		// Refused without comparing anything, for the reason given on
		// loginLimiter: evaluating while throttled would let an attacker search
		// straight through it.
		writeLoginPage(responseWriter, http.StatusTooManyRequests, loginPageData{
			Message:  throttledMessage,
			Redirect: redirect,
		})

		return
	}

	if !passwordMatches(request.PostFormValue("password")) {
		writeLoginPage(responseWriter, http.StatusUnauthorized, loginPageData{
			Message:  wrongPasswordMessage,
			Redirect: redirect,
		})

		return
	}

	logins.refund()
	issueSession(responseWriter, request)

	http.Redirect(responseWriter, request, redirect, http.StatusSeeOther)
}

// writeLoginPage renders the password field, with a message when there is one
// to give.
func writeLoginPage(responseWriter http.ResponseWriter, status int, data loginPageData) {
	responseWriter.Header().Set("Content-Type", "text/html; charset=utf-8")
	// Never cached: it is served in place of whatever was asked for, and a
	// shared cache holding it would hand the login page to someone who has
	// already logged in.
	responseWriter.Header().Set("Cache-Control", "no-store")
	responseWriter.WriteHeader(status)

	if err := loginTemplate.Execute(responseWriter, data); err != nil {
		slog.Error("API.Login: Error writing the login page", "err", err)
	}
}

// safeRedirect keeps the post-login jump inside this site.
//
// The target comes back through the form, so it is attacker controlled: an
// absolute URL, or anything starting with "//", would turn the login into an
// open redirect. Only a rooted path on this origin is honored.
func safeRedirect(target string) string {
	if !strings.HasPrefix(target, "/") || strings.HasPrefix(target, "//") {
		return "/"
	}

	return target
}
