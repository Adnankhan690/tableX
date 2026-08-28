package storage

import "context"

// unconfigured is the store a deployment gets when it has not set one up.
//
// A real value rather than a nil interface, for the same reason the payment registry always
// has a fallback provider (DECISIONS.md D2): every caller can invoke methods without a nil
// check, and the one branch that matters -- Configured() -- sits in the service, once, where
// it can be turned into an error a manager can read.
//
// Absent configuration is a legitimate state, not a broken one. A restaurant that pastes
// image URLs from its own website needs nothing here, and the platform token precedent
// (DECISIONS.md D14) is the same shape: a deployment does not acquire a capability because
// somebody half-filled a config file.
type unconfigured struct{}

// NewUnconfigured returns the no-op store.
func NewUnconfigured() Storage { return unconfigured{} }

func (unconfigured) Configured() bool { return false }

func (unconfigured) PresignPut(context.Context, string, string, int64) (*PresignedUpload, error) {
	return nil, ErrNotConfigured
}

func (unconfigured) Head(context.Context, string) (*ObjectInfo, error) {
	return nil, ErrNotConfigured
}

func (unconfigured) Peek(context.Context, string, int64) ([]byte, error) {
	return nil, ErrNotConfigured
}

// Delete succeeds rather than failing. It is called on cleanup paths that run after a
// database commit, where the caller has already given up its ability to roll back and the
// object it wants gone was never stored in the first place.
func (unconfigured) Delete(context.Context, string) error { return nil }

// PublicURL is empty, never a guess.
//
// This is what makes losing the storage configuration degrade to "dishes have no photo"
// rather than "every dish has a broken image". Rows keep their image_key, so restoring the
// configuration restores the photographs with no data change.
func (unconfigured) PublicURL(string) string { return "" }
