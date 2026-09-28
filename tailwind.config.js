/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Overrides Tailwind's default warm-gray "stone" scale with a
        // green-tinted dark neutral (same hue ~150deg throughout, lightness
        // steps chosen to match stone's originals 1:1) — per team request
        // for an overall greenish theme. Every existing bg-stone-*/
        // text-stone-*/border-stone-* class in the app picks this up
        // automatically, so contrast relationships built into the JSX stay
        // intact; this does NOT touch red/amber/emerald, which are the
        // app's semantic risk-tier colors (documented in the on-screen
        // color legend) and must keep meaning exactly what they already do.
        stone: {
          50: "hsl(150, 20%, 97%)",
          100: "hsl(150, 18%, 94%)",
          200: "hsl(150, 15%, 88%)",
          300: "hsl(150, 12%, 78%)",
          400: "hsl(150, 10%, 60%)",
          500: "hsl(150, 12%, 44%)",
          600: "hsl(150, 15%, 32%)",
          700: "hsl(150, 18%, 22%)",
          800: "hsl(150, 20%, 14%)",
          900: "hsl(150, 22%, 9%)",
          950: "hsl(150, 25%, 5%)",
        },
      },
    },
  },
  plugins: [],
}
