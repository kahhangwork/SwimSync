import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    // lib/ holds literal class strings too (lib/classColours.ts — the class
    // colour palette). Without this line those swatches render blank.
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      // DESIGN.md's tokens. The legacy sky shades (`primary-50…900`) were deleted in
      // UI restyle 7.1, once no screen used them; the drift test's palette guard
      // keeps every Tailwind default-palette colour out of the source.
      // TWIN: SwimSyncApp/tailwind.config.js holds the same tokens; each app's
      // lib/designTokens.drift.test.ts pins its copy to DESIGN.md's front matter.
      colors: {
        primary: {
          // DESIGN.md Lane Blue: `bg-primary`, `hover:bg-primary-hover`.
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
      // line-height, and the twin config must say the same thing.
      // REM here, unlike the app's px twin: the admin shrinks its root font
      // 16→13px below 1536px so the whole panel scales together (globals.css),
      // and the user chose (2026-10-12, UI restyle 1.6) that DESIGN.md's sizes
      // scale with it. Each value is DESIGN.md's px ÷ 16; the drift test converts.
      fontSize: {
        display: ["1.5rem", { lineHeight: "1.8rem", letterSpacing: "-0.02em" }],
        headline: ["1rem", { lineHeight: "1.3rem" }],
        body: ["0.875rem", { lineHeight: "1.3125rem" }],
        "body-secondary": ["0.8125rem", { lineHeight: "1.178125rem" }],
        label: ["0.75rem", { lineHeight: "0.975rem" }],
      },
      // Geist comes from next/font in app/layout.tsx as --font-geist (a hashed
      // family name, self-hosted). `sans` is what preflight puts on <html>, so
      // every screen gets it; `geist` stays as DESIGN.md's named class.
      fontFamily: {
        sans: ["var(--font-geist)", "Geist", "system-ui", "sans-serif"],
        geist: ["var(--font-geist)", "Geist", "system-ui", "sans-serif"],
      },
      // The only shadow: things that float (modals, menus, toasts).
      boxShadow: { float: "0 8px 24px rgba(0, 0, 0, 0.08)" },
    },
  },
  plugins: [],
};

export default config;
