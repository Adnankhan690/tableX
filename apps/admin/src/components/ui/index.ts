/**
 * The admin panel's primitives.
 *
 * These are admin-local on purpose. packages/ui holds only what is pixel-identical in both apps
 * (docs/CONTRIBUTING.md), and none of this is: the diner app is warm, mobile-first and anonymous,
 * this one is cool, dense and driven by staff on a counter laptop. Anything that would need an
 * `isAdmin` prop to satisfy both is two components.
 *
 * Compose these rather than restyling a div. The point of the set is that a manager who has
 * learned one button, one field and one notice has learned all of them.
 */

export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
  IconButton,
  type IconButtonProps,
} from './button'
export { Card, CardHeader, type CardHeaderProps, type CardProps, CardSection } from './card'
export { Dialog, type DialogProps } from './dialog'
export {
  Badge,
  type BadgeProps,
  Count,
  EmptyState,
  type EmptyStateProps,
  Notice,
  type NoticeProps,
  Skeleton,
  type Tone,
} from './feedback'
export { Field, type FieldProps, Input, type InputProps, Textarea } from './field'
export {
  SearchInput,
  type SearchInputProps,
  ToggleChip,
  type ToggleChipProps,
  Toolbar,
} from './toolbar'
