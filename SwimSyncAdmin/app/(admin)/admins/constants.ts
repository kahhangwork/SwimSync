import type { Tone } from "@/components/ui/Tag";
// Admins page — module-level constants.

import type { AdminRow } from "./types";

// An admin's account state as a Tag tone (UI restyle 5.24): invited is waiting
// on the invitee (Info), active is the done state, deactivated is neutral.
export const STATUS_TONE: Record<NonNullable<AdminRow["status"]>, Tone> = {
  active: "success",
  invited: "info",
  deactivated: "neutral",
};
