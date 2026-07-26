package utils

import (
	"log/slog"

	"github.com/glimesh/broadcast-box/internal/environment"
)

func DebugOutputOffer(offer string) string {
	if environment.ShouldDebugPrintOffer() {
		slog.Info("Offer", "sdp", offer)
	}

	return offer
}

func DebugOutputAnswer(answer string) string {
	if environment.ShouldDebugPrintAnswer() {
		slog.Info("Answer", "sdp", answer)
	}

	return answer
}
