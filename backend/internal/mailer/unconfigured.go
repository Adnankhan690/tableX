package mailer

import "context"

// unconfigured is the mailer a deployment gets with no provider credentials.
//
// It refuses rather than pretending, which is the same shape as storage.NewUnconfigured: the
// alternative is a local machine where every send "succeeds" and the first real deployment is
// where anyone discovers the key was never set.
type unconfigured struct{}

// NewUnconfigured returns the mailer that cannot send.
func NewUnconfigured() Mailer { return unconfigured{} }

func (unconfigured) Configured() bool { return false }

func (unconfigured) Send(context.Context, Message) error { return ErrNotConfigured }
