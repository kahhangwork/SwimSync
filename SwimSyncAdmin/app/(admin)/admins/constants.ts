// Admins page — module-level constants.

import type { AdminRow } from "./types";

export const STATUS_PILL: Record<NonNullable<AdminRow["status"]>, string> = {
  active: "bg-green-100 text-green-700",
  invited: "bg-amber-100 text-amber-700",
  deactivated: "bg-gray-200 text-gray-600",
};
