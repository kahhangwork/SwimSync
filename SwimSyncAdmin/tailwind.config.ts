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
      colors: {
        primary: {
          50:  "#f0f9ff",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
        },
      },
    },
  },
  plugins: [],
};

export default config;
