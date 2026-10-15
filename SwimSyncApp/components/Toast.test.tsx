// Toast — the global feedback banner. Pinned: every fill is a DESIGN.md token
// (tailwind.config.js), and white text on it meets WCAG AA (4.5:1). The 7.2 audit
// (BACKLOG *UI restyle leftovers*) found Tailwind defaults here, with white on the
// success green at 3.3:1.
//
// RED FIRST (§7.25) — against the pre-fix colours (#16a34a / #dc2626 / #334155):
//   "success is status.success.text"        → Expected "#166534", Received "#16a34a"
//   "error is status.danger.text"           → Expected "#b91c1c", Received "#dc2626"
//   "info is ink"                           → Expected "#0a0a0a", Received "#334155"
//   "white on success meets AA"             → 3.30 < 4.5
const config = require("../tailwind.config.js");
import { TOAST_COLORS } from "./Toast";

const colors = config.theme.extend.colors;

/** WCAG 2 relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastOnWhite(hex: string): number {
  return (1 + 0.05) / (luminance(hex) + 0.05);
}

describe("Toast colours", () => {
  it("success is status.success.text", () => {
    expect(TOAST_COLORS.success).toBe(colors.status.success.text);
  });

  it("error is status.danger.text", () => {
    expect(TOAST_COLORS.error).toBe(colors.status.danger.text);
  });

  it("info is ink", () => {
    expect(TOAST_COLORS.info).toBe(colors.ink.DEFAULT);
  });

  it.each(["success", "error", "info"])("white on %s meets AA", (type) => {
    expect(contrastOnWhite(TOAST_COLORS[type])).toBeGreaterThanOrEqual(4.5);
  });
});
