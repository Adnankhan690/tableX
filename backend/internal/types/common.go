// Package types holds the request and response DTOs that form the HTTP contract.
//
// These are deliberately separate from package models. A model is a database row; a DTO is
// what goes on the wire. Keeping them apart is what stops a new internal column -- or
// StaffUser.PasswordHash -- from appearing in a public response because someone added a
// field to a struct that happened to be serialised.
//
// packages/shared/src/types.ts mirrors this package. The two change together.
package types

// Pagination is the shared list-request shape.
type Pagination struct {
	// Page is 1-based.
	Page int `form:"page" json:"page"`
	// PerPage is clamped by Normalize; an unbounded page size is a cheap way to make the
	// server serialise an entire table.
	PerPage int `form:"per_page" json:"per_page"`
}

// Default and maximum page sizes.
const (
	DefaultPerPage = 25
	MaxPerPage     = 100
)

// Normalize fills in defaults and clamps out-of-range values, so a handler can use the
// values directly without re-checking them.
func (p *Pagination) Normalize() {
	if p.Page < 1 {
		p.Page = 1
	}
	if p.PerPage < 1 {
		p.PerPage = DefaultPerPage
	}
	if p.PerPage > MaxPerPage {
		p.PerPage = MaxPerPage
	}
}

// Offset is the SQL OFFSET for this page.
func (p *Pagination) Offset() int { return (p.Page - 1) * p.PerPage }

// Limit is the SQL LIMIT for this page.
func (p *Pagination) Limit() int { return p.PerPage }

// PageMeta describes a page of results.
type PageMeta struct {
	Page       int   `json:"page"`
	PerPage    int   `json:"per_page"`
	Total      int64 `json:"total"`
	TotalPages int   `json:"total_pages"`
}

// NewPageMeta computes page metadata from a total row count.
func NewPageMeta(p Pagination, total int64) PageMeta {
	pages := 0
	if p.PerPage > 0 {
		pages = int((total + int64(p.PerPage) - 1) / int64(p.PerPage))
	}
	return PageMeta{Page: p.Page, PerPage: p.PerPage, Total: total, TotalPages: pages}
}

// Money is how every amount crosses the wire.
//
// Minor carries the authoritative integer value (paise); Display is a pre-formatted
// string. Both are sent so the client never does currency arithmetic or reimplements
// Indian digit grouping in JavaScript -- and so a diner and the kitchen are guaranteed to
// be reading the same number (DECISIONS.md D7).
type Money struct {
	Minor    int64  `json:"minor"`
	Currency string `json:"currency"`
	Display  string `json:"display"`
}
