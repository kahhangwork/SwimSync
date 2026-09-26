/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    // Tier folders of refactored screens live OUTSIDE app/ (Expo Router routes
    // every file there). Unscanned, a class used only in features/*/ui is purged
    // with no error — the admin's §7.191 trap.
    "./features/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  // "class", not the default "media": under "media" NativeWind's web runtime
  // throws on every page load. Inert while the app is light-only — pinned by
  // lib/darkMode.drift.test.ts.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: {
          50:  "#f0f9ff",
          100: "#e0f2fe",
          200: "#bae6fd",
          300: "#7dd3fc",
          400: "#38bdf8",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
          800: "#075985",
          900: "#0c4a6e",
        },
      },
    },
  },
  plugins: [],
};
