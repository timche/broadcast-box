package utils

import (
	"strings"

	"github.com/glimesh/broadcast-box/internal/environment"
)

// Appends a candidate to the list of candidates that are sent back to the client in the answer
func AppendCandidateToAnswer(localDescriptionSFP string) string {
	if appendCandidate := environment.GetAppendCandidate(); appendCandidate != "" {
		index := strings.Index(localDescriptionSFP, "a=end-of-candidates")
		localDescriptionSFP = localDescriptionSFP[:index] + appendCandidate + localDescriptionSFP[index:]
	}

	return localDescriptionSFP
}
