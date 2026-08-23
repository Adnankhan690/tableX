import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Joins class names and lets a later Tailwind utility beat an earlier one in the same group.
 *
 * The merge is what makes the `className` prop on these primitives honest. Without it a
 * caller passing `px-4` ends up with both `px-2` and `px-4` in the list and the winner is
 * decided by the order rules landed in the stylesheet -- something the caller cannot see
 * and did not choose.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
