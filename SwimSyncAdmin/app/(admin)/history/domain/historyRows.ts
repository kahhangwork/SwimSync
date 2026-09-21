import type { AuditDiff } from "./auditDiff";

export function formatWhen(ts: string): string {
  // Display only — never fed back into date logic. Explicit SGT so the row
  // reads in the admin's own timezone regardless of the browser's.
  return new Date(ts).toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const KIND_LABEL: Record<AuditDiff["kind"], string> = {
  created: "Created",
  updated: "Changed",
  deleted: "Removed",
  unknown: "—",
};
