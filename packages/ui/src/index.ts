/**
 * The primitives that are pixel-identical in both apps, and nothing else.
 *
 * The diner app and the admin panel are deliberately unalike (docs/DECISIONS.md D11), so the
 * bar for living here is high: a component earns its place only if both apps want the same
 * markup, not merely the same idea. Anything that would need an `isAdmin` prop or a variant
 * enum to satisfy both is two components, and each belongs in its own app.
 *
 * Two things every consuming app owes this package:
 *
 * 1. Tailwind must scan it, or the utilities below are never generated:
 *      content: [..., '../../packages/ui/src/**\/*.{ts,tsx}']
 *    Next must also transpile it, since it is published as TypeScript source:
 *      transpilePackages: ['@tablex/ui']
 *
 * 2. Colour comes from CSS variables with neutral fallbacks, so an app themes these without
 *    forking them. The full set:
 *      --tx-fg, --tx-muted-fg, --tx-error-fg
 *      --tx-tone-{new,progress,ready,done,failed}-{bg,fg}   (StatusBadge)
 *      --tx-food-{veg,nonveg,egg}                           (FoodTypeBadge)
 *    Every component also emits data attributes (`data-status`, `data-tone`,
 *    `data-food-type`), which is the escape hatch for restyling by selector and the handle
 *    tests should assert on -- copy gets translated (PRD 7), machine values do not.
 */

export { Base64Image, type Base64ImageProps } from './Base64Image'
export { cn } from './cn'
export { EmptyState, type EmptyStateProps } from './EmptyState'
export { ErrorState, type ErrorStateProps } from './ErrorState'
export { FoodTypeBadge, type FoodTypeBadgeProps } from './FoodTypeBadge'
export { Money, type MoneyProps } from './Money'
export { Spinner, type SpinnerProps } from './Spinner'
export { StatusBadge, type StatusBadgeProps } from './StatusBadge'
