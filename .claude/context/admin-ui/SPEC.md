# The admin panel's design system

What this is: the decisions behind the visual overhaul of `apps/admin`, so the next person to add a
screen does not have to re-derive them. The audit that prompted it is in [FINDINGS.md](./FINDINGS.md)
— 127 findings across every surface.

## The direction

**A precision console with operational colour.** Near-monochrome neutrals, structure carried by
hairlines rather than boxes, one accent, and colour reserved for state and urgency. It is a panel
driven at speed during dinner service — partly on a tablet at arm's length — so legibility and an
unmistakable primary action outrank decoration, and premium here reads as restraint plus care in the
details, not as ornament.

Four rules that decide anything this document does not cover:

1. **One filled button per surface.** If a screen has two, one of them is lying about its
   importance. Destructive actions are quiet until the moment of confirmation, where they become
   filled inside a dialog.
2. **Colour means state.** Red is a refusal or a failure; amber is money not yet collected or a
   consequence worth reading; green is settled. Nothing is red because it is a button.
3. **A disabled control still has to be readable.** It swaps tokens; it never fades. See below.
4. **Every list owes an empty state, a loading state and a failure state**, and a failure never
   looks like a confirmation.

## Tokens

Defined once in `apps/admin/src/app/globals.css` and reached through Tailwind names in
`apps/admin/tailwind.config.ts`. Ratios are against `--ad-surface` (white) unless stated.

| Token | Value | Role |
|---|---|---|
| `--ad-bg` | `#f6f7f9` | page canvas, 1.04:1 off white so a card reads as raised without a heavy shadow |
| `--ad-surface` | `#ffffff` | cards, rails, bars |
| `--ad-surface-sunken` | `#f1f3f7` | inert or disabled control |
| `--ad-field` | `#fbfcfd` | the fill of an editable field — distinct from sunken so a disabled input and a live one differ |
| `--ad-ink` | `#0e1520` | 18.9:1 — headings, values, anything load-bearing |
| `--ad-muted` | `#505c6e` | 7.4:1 — secondary text |
| `--ad-faint` | `#6c7889` | 4.6:1 — micro-labels; still passes body text |
| `--ad-divider` | `#e9edf3` | rules between rows in one container |
| `--ad-line` | `#dce2ea` | the edge of a card against the canvas |
| `--ad-line-strong` | `#bcc7d6` | the edge of a control, always paired with a field fill |
| `--ad-accent` | `#0b57d0` | white on it is 5.6:1, so a filled button carries its label at AA |
| `--ad-danger` / `--ad-warning` / `--ad-success` | `#b4231b` / `#8a4b00` / `#0a6b3c` | 6.4:1 / 6.9:1 / 5.9:1 — each with a `-soft` fill and a `-line` edge |
| `--ad-age-warn` / `--ad-age-late` | `#ffeecb` / `#ffdcd7` | the top of an order card's escalation gradient |
| `--ad-age-warn-line` / `--ad-age-late-line` | `#f0c98d` / `#efa79d` | that card's outline |

**Three weights of line, not one.** The previous single `--ad-line` had to be crisp enough to
outline a card and quiet enough to rule a table, and could be neither: at 1.66:1 every list became a
stack of boxes.

**Escalation tints the card, as a gradient, and that is a product decision, not a default.** The
audit argued for a 3px edge bar so the card body could stay white; it was built that way, reviewed,
and reversed on the owner's call — a tinted card is recognisable across a kitchen in a way an edge
bar is not. A *flat* tint then failed for a different reason: white outlined buttons read as holes
punched in the card and the blue primary clashed with the pink. So the tint holds through the top
half — order number, status, clock — and fades to the card surface by the bottom, where the controls
live. These two values remain the binding constraint on the palette: each is measured against ink,
muted **and** danger at the strong end of the gradient (late 7.4 / 5.3 / 5.2; warn 8.2 / 5.8 / 5.7),
and darkening either fill breaks the muted and danger pairings before the headline ink ratio.

**Opacity modifiers do not work on these tokens.** `bg-accent/40` silently produces nothing. Every
state that looks translucent is its own solid token.

## Type

Inter, self-hosted by `next/font` — no new dependency, no runtime request, no layout shift. The
diner app deliberately uses system faces because PRD §7 makes its payload a product requirement;
that does not reach an authenticated panel opened once a shift.

Named sizes, so a component picks a role rather than a number: `micro` 11px (column headers only),
`xs` 12, `sm` 13, `base` 14, `lg` 16 (card titles), `title` 18 (the page `h1`), `metric` 22
(figures), `display` 24 (auth screens). Money and counts carry `[font-variant-numeric:tabular-nums]`
so a column does not jitter as the digits change.

## Icons

`lucide-react`, at 14–18px with `strokeWidth` 1.5–2 depending on size — lucide's 2px default is
drawn for 24px and reads heavy next to 12px text. One icon system, used everywhere: nav, filters,
notices, empty states, chevrons, the stats strip. The two brand marks (the rail monogram, the login
wordmark) stay hand-drawn, because a logo is not an icon.

This is a **deliberate exception** to the rule in `docs/CONTRIBUTING.md` that these apps ship no
icon library. That rule is written for the diner app, where PRD §7 makes payload a product
requirement; this panel is authenticated and held open for a shift. Same argument as the webfont.
Nothing else gets added without making it again.

## Primitives

In `apps/admin/src/components/ui/`. Admin-local on purpose: `packages/ui` holds only what is
pixel-identical in both apps, and none of this is.

`Button` (primary / secondary / ghost / danger / danger-quiet, sizes sm+md, `loading` with a
present-tense label) · `IconButton` (label required) · `Card` / `CardHeader` / `CardSection` ·
`Field` / `Input` / `Textarea` (label wired by `htmlFor`, hint and error in one place, affixes inside
the control) · `Badge` / `Count` · `Notice` (tone drives the aria role) · `EmptyState` · `Skeleton` ·
`Dialog` (native `<dialog>`, named and described) · `Toolbar` / `ToggleChip` / `SearchInput`.

Icons are passed as *components*, not markup: `EmptyState` and `Notice` take a `LucideIcon`, so a
caller names an icon rather than drawing one and every disc, tint and stroke width stays consistent.

Two conventions worth stating:

**Disabled is a token swap, never an opacity.** `disabled:opacity-40` was on 19 controls, and it
fades the label with the fill: white-on-accent became 1.9:1, so "Add", "Update password" and "Save
settings" were illegible in the state they open in. Every variant swaps to the sunken surface with
muted ink and keeps the text readable.

**Never `outline-none` on an input.** Tailwind compiles it to a transparent 2px outline in the
utilities layer, which outranks the `:focus-visible` rule in `@layer base` and silently deletes the
focus ring. Six inputs did that, on the one screen where a stray keystroke changes a price.

## The stats strip

Worth its own note, because it is the surface that most easily degrades into a list of numbers.
Three rules hold it up:

1. **A hairline cell grid, made of gaps.** The container is `bg-divider` with `gap-px`, and each
   cell paints its own `bg-surface` — so the gaps *are* the rules. That survives wrapping at any
   column count (8 → 4 → 2), where a per-cell `border-l` draws a stray line at the start of every
   wrapped row.
2. **Every figure states what it means.** Eight bare numbers make the reader do the arithmetic — is
   3 live a lot? is ₹1,470 unpaid bad? Each cell carries one context line: a share of today, a
   definition of what the server actually sums (`Collected` = paid orders only; `On open orders` =
   pending payment on non-terminal ones), or a comparison to a real threshold. Nothing here needed
   an API change.
3. **Targets come from the product, not from taste.** "Avg. to accept" is measured against
   `AGE_WARN_SECONDS` — the same constant at which an order card starts tinting — and turns green
   or amber against it. Reusing the board's own escalation threshold is what makes it a target
   rather than a decorated number.

The one micro-visualisation is the composition bar under `Placed`, and it is there because placed
*is* exactly live + completed + cancelled. Anything else would be a sparkline of data this endpoint
does not return.

## Layout

- The rail is `sticky h-dvh` at `lg` and a top bar below it. It was `md`, so the 224px rail was
  still eating 27% of the 820px tablet the panel is deployed on. Sticky is also what makes the
  account footer's `mt-auto` resolve against the viewport instead of the document — sign-out used to
  sit 1,500px below the fold on a long menu.
- `PageHeader` is sticky, carries the page's one primary action, and takes `back` for detail pages.
- **The order board's pipeline stays monotonic**: five columns at `xl`, one full-width stage per row
  below it. The old wrapping 2-up grid put the PREPARING heading directly under NEW's cards.
- Long forms get a sticky save bar that states whether there is anything to save.

## Do not break

Light theme only — no dark block, no toggle. No new dependencies: inline SVG, no icon or animation
library. `packages/ui` and `apps/diner` are off limits. Tap targets stay ≥ 40px (`min-h-tap`). No
page scrolls sideways at 820px. `.no-print` and the `@media print` block keep the QR sheet printable.

Three suites hold the line, and they assert on roles, `data-*` and behaviour rather than on styling:
`e2e/admin-journey.mjs` (55), `e2e/ui-smoke.mjs` (76), `e2e/select.mjs` (45).
