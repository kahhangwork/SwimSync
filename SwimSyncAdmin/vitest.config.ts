import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // globals so @testing-library/react registers its auto-cleanup afterEach;
    // the test API itself is imported explicitly so the files stay tsc-clean
    // for `next build` (which type-checks **/*.tsx).
    globals: true,
  },
  resolve: {
    // Mirror tsconfig "@/*" -> "./*"
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
