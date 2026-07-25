package authorization

import (
	"fmt"
	"log/slog"
	"os"

	"github.com/glimesh/broadcast-box/internal/environment"
	"github.com/google/uuid"
)

func assureProfilePath() {
	profilePath := os.Getenv(environment.StreamProfilePath)

	err := os.MkdirAll(profilePath, os.ModePerm)
	if err != nil {
		slog.Error("Authorization: Error creating profile path folder folder", "err", err)
		return
	}
}

// hasExistingStreamKey reports whether a profile file starts with
// "<streamKey>_". The match is a case sensitive prefix test over the cached
// file names, exactly as the previous directory scan did.
func hasExistingStreamKey(streamKey string) bool {
	filePrefix := streamKey + profileFileSeparator

	return profileFiles.has(func(idx *profileIndex) bool {
		return idx.anyNameHasPrefix(filePrefix)
	})
}

// hasExistingBearerToken reports whether a profile file name ends with
// bearerToken. This is a case sensitive suffix test rather than an exact token
// comparison, which is deliberately kept identical to the previous directory
// scan; getProfileFileNameByBearerToken is the function that actually resolves
// a token to a profile.
func hasExistingBearerToken(bearerToken string) bool {
	return profileFiles.has(func(idx *profileIndex) bool {
		return idx.anyNameHasSuffix(bearerToken)
	})
}

// getProfileFileNameByStreamKey returns the profile file whose name up to the
// first "_" case insensitively equals streamKey, preferring the first such file
// in os.ReadDir order.
func getProfileFileNameByStreamKey(streamKey string) (string, error) {
	fileName, found, err := profileFiles.find(func(idx *profileIndex) (string, bool) {
		return idx.fileNameByStreamKey(streamKey)
	})
	if err != nil {
		return "", err
	}

	if !found {
		return "", fmt.Errorf("could not find profile file")
	}

	return fileName, nil
}

// getProfileFileNameByBearerToken returns the profile file whose name after the
// last "_" case insensitively equals bearerToken, preferring the first such
// file in os.ReadDir order.
func getProfileFileNameByBearerToken(bearerToken string) (string, error) {
	fileName, found, err := profileFiles.find(func(idx *profileIndex) (string, bool) {
		return idx.fileNameByToken(bearerToken)
	})
	if err != nil {
		return "", err
	}

	if !found {
		return "", fmt.Errorf("could not find profile file")
	}

	return fileName, nil
}

func generateToken() string {
	token := uuid.New().String()

	if hasExistingBearerToken(token) {
		return generateToken()
	}

	return token
}
