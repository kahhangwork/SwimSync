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
      // DESIGN.md's tokens, ADDED beside the legacy palette — nothing here
      // renames a class a screen already uses, so adding them changes no screen.
      // Screens adopt them one at a time (BACKLOG → UI/UX improvements).
      // TWIN: SwimSyncApp/tailwind.config.js holds the same tokens; each app's
      // lib/designTokens.drift.test.ts pins its copy to DESIGN.md's front matter.
      colors: {
        primary: {
          // Legacy sky shades — still on most screens until each migrates.
          50:  "#f0f9ff",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
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
      fontSize: {
        display: ["24px", { lineHeight: "28.8px", letterSpacing: "-0.02em" }],
        headline: ["16px", { lineHeight: "20.8px" }],
        body: ["14px", { lineHeight: "21px" }],
        "body-secondary": ["13px", { lineHeight: "18.85px" }],
        label: ["12px", { lineHeight: "15.6px" }],
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
