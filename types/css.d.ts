/**
 * Ambient declaration for side-effect imports of a plain stylesheet.
 *
 * Next ships `next/types/global.d.ts`, which `next-env.d.ts` pulls in, and it declares
 * `*.module.css`, `*.module.sass` and `*.module.scss` — CSS MODULES, which have a shape worth
 * typing because you import an object out of them. It does not declare bare `*.css`, and both
 * apps import one:
 *
 *   apps/diner/src/app/layout.tsx              import './globals.css'
 *   apps/diner/src/app/(marketing)/layout.tsx  import './marketing.css'
 *   apps/admin/src/app/layout.tsx              import './globals.css'
 *
 * A side-effect import has no binding to type, so `tsc --noEmit` lets it through and the build is
 * unaffected. An editor's language service is stricter and reports "Cannot find module or type
 * declarations for side-effect import" on the first line of every root layout — a permanent red
 * squiggle on a correct file, which is the kind of thing people learn to ignore and then miss a
 * real error behind.
 *
 * ONE FILE, NOT ONE PER APP. Each app's tsconfig includes it explicitly by relative path, because
 * their `include` globs are app-scoped and would not otherwise reach outside their own directory.
 * If a third app appears, add the same line to its tsconfig rather than copying this.
 *
 * `next-env.d.ts` is the file that would otherwise be the natural home, and it says at the top
 * that it should not be edited — Next rewrites it on every build.
 */

declare module '*.css' {
  const content: void
  export default content
}
