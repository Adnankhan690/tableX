/**
 * Tailwind 3.4 runs as a PostCSS plugin; autoprefixer follows it so vendor prefixes are
 * added to the generated utilities and not just to the hand-written CSS in globals.css.
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
