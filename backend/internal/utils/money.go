package utils

import (
	"fmt"
	"strconv"
	"strings"
)

// Money in this application is always an int64 count of minor units -- paise for INR.
// No float64 ever touches an amount (DECISIONS.md D7). These helpers are the only place
// minor units are converted for display, and they are exact.

// BasisPointsDivisor converts a basis-point rate to a fraction: 500 bps = 5.00%.
const BasisPointsDivisor = 10000

// ApplyBasisPoints returns amount * bps / 10000, rounded half-up.
//
// Rounding is explicit because integer division truncates, and truncating tax
// systematically undercharges by up to one paisa per order -- which is both wrong and,
// aggregated over a year of service, a real number on a GST return.
func ApplyBasisPoints(amountMinor int64, bps int) int64 {
	if bps <= 0 || amountMinor == 0 {
		return 0
	}
	product := amountMinor * int64(bps)
	// Half-up: add half the divisor before dividing.
	return (product + BasisPointsDivisor/2) / BasisPointsDivisor
}

// FormatMinor renders minor units as a plain decimal string, "24950" -> "249.50".
func FormatMinor(amountMinor int64) string {
	neg := amountMinor < 0
	if neg {
		amountMinor = -amountMinor
	}
	major := amountMinor / 100
	minor := amountMinor % 100
	s := fmt.Sprintf("%d.%02d", major, minor)
	if neg {
		return "-" + s
	}
	return s
}

// FormatINR renders minor units for display with the rupee symbol and Indian digit
// grouping: 1234567890 paise -> "Rs 1,23,45,678.90".
//
// Indian grouping is not the western thousands separator -- it groups the last three
// digits, then pairs. A bill that reads "12,345,678" to an Indian diner looks like a
// typo, and this is a diner-facing product.
func FormatINR(amountMinor int64) string {
	neg := amountMinor < 0
	if neg {
		amountMinor = -amountMinor
	}
	major := strconv.FormatInt(amountMinor/100, 10)
	minor := fmt.Sprintf("%02d", amountMinor%100)

	grouped := groupIndian(major)
	if neg {
		return "-₹" + grouped + "." + minor
	}
	return "₹" + grouped + "." + minor
}

// groupIndian inserts separators using the Indian lakh/crore convention.
func groupIndian(n string) string {
	if len(n) <= 3 {
		return n
	}
	head, tail := n[:len(n)-3], n[len(n)-3:]

	var parts []string
	for len(head) > 2 {
		parts = append([]string{head[len(head)-2:]}, parts...)
		head = head[:len(head)-2]
	}
	if head != "" {
		parts = append([]string{head}, parts...)
	}
	return strings.Join(parts, ",") + "," + tail
}

// ParseMajorToMinor converts a decimal string such as "249.50" into minor units.
//
// Used only at trusted admin-input boundaries (menu price entry). It rejects more than
// two decimal places rather than rounding, so a mistyped "249.555" is a visible error
// instead of a silently altered price.
func ParseMajorToMinor(s string) (int64, error) {
	s = strings.TrimSpace(strings.ReplaceAll(s, ",", ""))
	if s == "" {
		return 0, fmt.Errorf("empty amount")
	}

	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(strings.TrimPrefix(s, "-"), "+")

	whole, frac, hasFrac := strings.Cut(s, ".")
	if whole == "" {
		whole = "0"
	}
	major, err := strconv.ParseInt(whole, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid amount %q", s)
	}

	var minor int64
	if hasFrac {
		if len(frac) > 2 {
			return 0, fmt.Errorf("amount %q has more than two decimal places", s)
		}
		padded := (frac + "00")[:2]
		if minor, err = strconv.ParseInt(padded, 10, 64); err != nil {
			return 0, fmt.Errorf("invalid amount %q", s)
		}
	}

	total := major*100 + minor
	if neg {
		total = -total
	}
	return total, nil
}
