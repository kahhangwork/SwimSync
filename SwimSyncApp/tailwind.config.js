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
      // DESIGN.md's tokens. The legacy sky shades (`primary-50…900`) were deleted in
      // UI restyle 7.1, once no screen used them; the drift test's palette guard
      // keeps every Tailwind default-palette colour out of the source.
      // TWIN: SwimSyncAdmin/tailwind.config.ts holds the same tokens; each app's
      // lib/designTokens.drift.test.ts pins its copy to DESIGN.md's front matter.
      colors: {
        primary: {
          // DESIGN.md Lane Blue: `bg-primary`, `active:bg-primary-hover`.
          DEFAULT: "#2563eb",
          hover: "#1d4ed8",
        },
        ink: { DEFAULT: "#0a0a0a", secondary: "#525252", muted: "#6b6b6b" },
        ground: "#fafafa",
        surface: "#ffffff",
        border: { DEFAULT: "#e5e5e5", strong: "#d4d4d4" },
        divider: "#f0f0f0",
        selected: "#ededed",
        status: {
          neutral: { text: "#525252", bg: "#f5f5f5", border: "#e5e5e5" },
          info:    { text: "#1e40af", bg: "#eff6ff", border: "#bfdbfe" },
          warning: { text: "#92400e", bg: "#fffbeb", border: "#fde68a" },
          danger:  { text: "#b91c1c", bg: "#fef2f2", border: "#fecaca" },
          success: { text: "#166534", bg: "#f0fdf4", border: "#bbf7d0" },
        },
      },
      // DESIGN.md's sm/md/lg, renamed: Tailwind already owns rounded-sm (2px).
      borderRadius: { tag: "4px", control: "6px", card: "8px" },
      // Line heights in px, not multipliers: React Native has no unitless
      // line-height.
      fontSize: {
        display: ["24px", { lineHeight: "28.8px", letterSpacing: "-0.02em" }],
        headline: ["16px", { lineHeight: "20.8px" }],
        body: ["14px", { lineHeight: "21px" }],
        "body-secondary": ["13px", { lineHeight: "18.85px" }],
        label: ["12px", { lineHeight: "15.6px" }],
      },
      // Geist is loaded by components/GeistFonts.tsx (400/500/600 faces under
      // one family). On web it also reaches every RN-web Text, which sets its
      // own font and so never reads `sans`.
      fontFamily: {
        sans: ["Geist", "system-ui", "sans-serif"],
        geist: ["Geist", "system-ui", "sans-serif"],
      },
      // The only shadow: things that float (modals, menus, toasts).
      boxShadow: { float: "0 8px 24px rgba(0, 0, 0, 0.08)" },
    },
  },
  plugins: [],
};
