import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // /lesson-coaches was renamed to /substitutes (2026-08-17) for clarity —
      // the page is substitute-cover only (shadows live on Classes). Kept as a
      // permanent redirect so any old bookmark lands on the new URL, not a 404.
      { source: "/lesson-coaches", destination: "/substitutes", permanent: true },
    ];
  },
};

export default nextConfig;
