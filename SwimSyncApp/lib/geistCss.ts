export const GEIST_STACK = "Geist, system-ui, sans-serif";

// One family, one @font-face per weight, so `font-semibold` picks the real 600
// file instead of a synthesized bold. expo-font's web loader cannot do this — it
// writes one face per family name with no weight descriptor.
//
// RN-web gives every Text / TextInput its own `font: 14px System` through a
// classic class, so a Tailwind `fontFamily.sans` alone never reaches them.
// ⚠ Do NOT select that class by name: it is `css-text-<hash>` in dev but a bare
// `css-<hash>` in a production build (createIdentifier), so a `[class*="css-text-"]`
// rule passes every local check and does nothing on swimsync.sg. Select the
// `dir` attribute instead — RN-web sets it on every root Text and TextInput in
// both builds; nested Text inherits (`font: inherit`). `html [dir]` (0,1,1)
// outranks the class (0,1,0); an explicit inline fontFamily (Ionicons) still wins.
export function geistCss(uris: ReadonlyArray<readonly [number, string]>): string {
  const faces = uris
    .map(
      ([weight, uri]) =>
        `@font-face{font-family:Geist;font-style:normal;font-weight:${weight};font-display:swap;src:url("${uri}") format("truetype")}`
    )
    .join("");
  return `${faces}html [dir]{font-family:${GEIST_STACK}}`;
}
