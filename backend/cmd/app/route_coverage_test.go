package app

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// This test is the reason the Bruno collection can be trusted.
//
// An API collection rots the moment it stops being the thing anyone checks. Documentation drifts
// silently -- nothing fails, the file is just wrong, and the next person to reach for it wastes an
// afternoon discovering that. Making it a build gate turns "someone should update the collection"
// into "the build is red", which is the only version of that instruction that survives a deadline.
//
// It parses source rather than booting the app because building an App needs a database, and a test
// that needs a database is a test that gets skipped.

// routeCall matches a Gin registration: admin.POST("/orders/:uid/transition", ...).
var routeCall = regexp.MustCompile(`(\w+)\.(GET|POST|PATCH|PUT|DELETE)\("([^"]+)"`)

// brunoMethodURL matches the method block at the top of a .bru request.
var brunoMethodURL = regexp.MustCompile(`(?m)^(get|post|patch|put|delete) \{\n  url: (\S+)`)

// groupPrefix maps the local variable a route is registered on to its mounted prefix. Kept in step
// with routes.go by hand -- if a new group appears there, this test fails closed (its routes are
// simply not collected, so nothing is asserted about them), which is why the count assertion at the
// bottom exists.
var groupPrefix = map[string]string{
	"public":   PublicAPIV1,
	"limited":  PublicAPIV1,
	"guest":    GuestAPIV1,
	"admin":    AdminAPIV1,
	"open":     AdminAPIV1,
	"platform": PlatformAPIV1,
}

type route struct {
	method string
	path   string
}

func TestEveryRouteHasABrunoRequest(t *testing.T) {
	routes := parseRoutes(t)
	requests := parseBrunoRequests(t)

	var missing []string
	for _, r := range routes {
		if !coveredBy(r, requests) {
			missing = append(missing, r.method+" "+r.path)
		}
	}

	sort.Strings(missing)
	if len(missing) > 0 {
		t.Errorf("%d route(s) have no request in backend/api_collection:\n  %s\n\n"+
			"Add one before merging. docs/API.md describes the conventions; the nearest existing\n"+
			"folder is usually the right place.",
			len(missing), strings.Join(missing, "\n  "))
	}
}

// TestBrunoRequestsPointAtRealRoutes catches the opposite drift: a request left behind after its
// route was renamed or removed. A collection full of 404s is worse than no collection, because it
// looks authoritative.
func TestBrunoRequestsPointAtRealRoutes(t *testing.T) {
	routes := parseRoutes(t)
	requests := parseBrunoRequests(t)

	var orphaned []string
	for _, req := range requests {
		matched := false
		for _, r := range routes {
			if r.method == req.method && pathsMatch(r.path, req.path) {
				matched = true
				break
			}
		}
		if !matched {
			orphaned = append(orphaned, req.method+" "+req.path)
		}
	}

	sort.Strings(orphaned)
	if len(orphaned) > 0 {
		t.Errorf("%d Bruno request(s) point at routes that do not exist:\n  %s",
			len(orphaned), strings.Join(orphaned, "\n  "))
	}
}

// TestRouteParsingFoundSomething guards the guard.
//
// Both tests above pass trivially if the parser silently matches nothing -- a refactor of routes.go
// that changed the registration style would make the coverage gate green and useless. This asserts
// the parser is still finding a plausible number of routes.
func TestRouteParsingFoundSomething(t *testing.T) {
	routes := parseRoutes(t)
	const atLeast = 40
	if len(routes) < atLeast {
		t.Fatalf("parsed only %d routes from routes.go, expected at least %d -- the regex or the "+
			"group-prefix map is out of date, and the coverage test above is no longer checking "+
			"anything", len(routes), atLeast)
	}

	requests := parseBrunoRequests(t)
	if len(requests) < atLeast {
		t.Fatalf("parsed only %d Bruno requests, expected at least %d", len(requests), atLeast)
	}
}

func parseRoutes(t *testing.T) []route {
	t.Helper()

	raw, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatalf("read routes.go: %v", err)
	}

	var out []route
	for _, m := range routeCall.FindAllStringSubmatch(string(raw), -1) {
		prefix, ok := groupPrefix[m[1]]
		if !ok {
			continue
		}
		out = append(out, route{method: m[2], path: prefix + m[3]})
	}
	return out
}

func parseBrunoRequests(t *testing.T) []route {
	t.Helper()

	root := filepath.Join("..", "..", "api_collection")
	var out []route

	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() || filepath.Ext(path) != ".bru" {
			return nil
		}
		// folder.bru and collection.bru carry metadata, not requests; environments carry variables.
		base := filepath.Base(path)
		if base == "folder.bru" || base == "collection.bru" ||
			strings.Contains(path, string(os.PathSeparator)+"environments"+string(os.PathSeparator)) {
			return nil
		}

		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		m := brunoMethodURL.FindStringSubmatch(string(raw))
		if m == nil {
			t.Errorf("%s has no method/url block", base)
			return nil
		}

		url := strings.TrimPrefix(m[2], "{{base_url}}")
		if i := strings.Index(url, "?"); i >= 0 {
			url = url[:i]
		}
		out = append(out, route{method: strings.ToUpper(m[1]), path: url})
		return nil
	})
	if err != nil {
		t.Fatalf("walk api_collection: %v", err)
	}
	return out
}

func coveredBy(r route, requests []route) bool {
	for _, req := range requests {
		if req.method == r.method && pathsMatch(r.path, req.path) {
			return true
		}
	}
	return false
}

// pathsMatch compares a Gin route against a Bruno URL.
//
// A Gin :param is satisfied by anything in that position -- a Bruno {{variable}}, a REPLACE_
// placeholder, or a literal value. The literal case is deliberate: the webhook route is
// /webhooks/payments/:provider, and the collection has concrete requests for "mock" and "razorpay"
// rather than one with a variable, because the two behave differently and both are worth having.
func pathsMatch(routePath, brunoPath string) bool {
	rp := strings.Split(strings.Trim(routePath, "/"), "/")
	bp := strings.Split(strings.Trim(brunoPath, "/"), "/")
	if len(rp) != len(bp) {
		return false
	}
	for i := range rp {
		if strings.HasPrefix(rp[i], ":") {
			continue
		}
		if rp[i] != bp[i] {
			return false
		}
	}
	return true
}
