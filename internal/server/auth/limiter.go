package auth

import (
	"sync"
	"time"
)

const (
	// Burst is sized so a household fumbling the password a few times in a row
	// is never turned away, while a dictionary run is throttled to roughly
	// twenty attempts a minute.
	loginBurst          = 10
	loginRefillInterval = 3 * time.Second
)

// loginLimiter throttles wrong passwords with a token bucket.
//
// The bucket is global rather than per-IP on purpose. Behind a CDN every
// request arrives from the edge, so RemoteAddr is the same handful of
// addresses for every viewer and a per-IP bucket would be one shared bucket
// wearing a disguise. Keying on a forwarded-for header instead would mean
// trusting a value the client controls, which hands an attacker unlimited
// attempts by rotating it. One honest global bucket is the smaller lie.
//
// A token is taken before the password is compared and given back when the
// comparison succeeds, so only failures actually drain it. That ordering is
// what makes the throttle work: once the bucket is empty nothing is evaluated
// at all, and a correct guess is indistinguishable from a wrong one. It does
// mean a sustained attack briefly locks out people who know the password,
// which is the trade being made, and it heals within seconds.
type loginLimiter struct {
	mutex      sync.Mutex
	tokens     float64
	lastRefill time.Time
}

var logins = &loginLimiter{tokens: loginBurst}

// allow reports whether an attempt may be evaluated, taking a token if so.
func (limiter *loginLimiter) allow(now time.Time) bool {
	limiter.mutex.Lock()
	defer limiter.mutex.Unlock()

	if limiter.lastRefill.IsZero() {
		limiter.lastRefill = now
	}

	limiter.tokens += now.Sub(limiter.lastRefill).Seconds() / loginRefillInterval.Seconds()
	limiter.tokens = min(limiter.tokens, loginBurst)
	limiter.lastRefill = now

	if limiter.tokens < 1 {
		return false
	}

	limiter.tokens--

	return true
}

// refund returns the token taken by allow, for an attempt that turned out to
// carry the right password.
func (limiter *loginLimiter) refund() {
	limiter.mutex.Lock()
	defer limiter.mutex.Unlock()

	limiter.tokens = min(limiter.tokens+1, loginBurst)
}
