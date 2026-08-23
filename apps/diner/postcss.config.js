/**
 * Tailwind 3.4 is a PostCSS plugin, so this file is what makes the @tailwind directives in
 * globals.css resolve. autoprefixer stays because the diner app targets whatever browser is
 * on the diner's phone -- including older Android WebViews inside in-app QR scanners, which
 * still want prefixes for flexbox gap and sticky positioning.
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
