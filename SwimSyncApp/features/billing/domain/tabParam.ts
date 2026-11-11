// `?tab=` on the Billing route opens that tab — the public package page's
// "choose another package" link lands on Packages (BACKLOG *UI restyle leftovers*:
// the page's "Tell your coach." was a dead end). Pure: unknown → null (no change).
import type { Tab } from "../types";

const BY_PARAM: Record<string, Tab> = {
  invoices: "Invoices",
  packages: "Packages",
  "credit-notes": "Credit Notes",
};

export function tabFromParam(param: string | string[] | undefined): Tab | null {
  const v = Array.isArray(param) ? param[0] : param;
  return (v && BY_PARAM[v.toLowerCase()]) || null;
}
