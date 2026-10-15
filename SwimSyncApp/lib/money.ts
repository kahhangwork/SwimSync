// The ONE way the app prints Singapore dollars: "S$1,260.00", "−S$40.00".
// Before this, ~40 screens each wrote `S$${x.toFixed(2)}`, so Coach Pay read
// "S$1260.00" (BACKLOG *UI restyle leftovers*).
//
// The grouping is done by hand, not with Intl/toLocaleString: the result must not
// depend on which ICU data Hermes or the browser ships, and a string a test pins
// must be the string a phone prints.
//
// NOT for machine-readable amounts — the PayNow QR payload (lib/paynow.ts) must
// stay a bare "1260.00"; a comma there breaks the bank app's parse.

/** "S$1,260.00", and "−S$40.00" (a minus sign, not a hyphen) below zero.
 *  Accepts a numeric string because PostgREST returns `numeric` columns as one. */
export function formatSgd(amount: number | string): string {
  const n = Number(amount);
  const [whole, cents] = Math.abs(n).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${n < 0 ? "−" : ""}S$${grouped}.${cents}`;
}
