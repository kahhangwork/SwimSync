// The loud/acknowledged state of a package's public-holiday extension.
//
// "loud"  — the extension exceeds what this viewer acknowledged → attention badge
// "quiet" — extended, but already acknowledged → a permanent, calm note
// "none"  — no holiday extension at all
//
// The comparison is per VIEWER: admin and parent hold separate ack high-waters
// (ph_ack_weeks_admin / ph_ack_weeks_parent), so pass the one for this surface.
// A later holiday raises ext above the stored ack and it goes loud again.

export type ExtensionState = "loud" | "quiet" | "none";

export function packageExtensionState(
  extWeeks: number,
  ackWeeks: number
): ExtensionState {
  if (extWeeks <= 0) return "none";
  return extWeeks > ackWeeks ? "loud" : "quiet";
}
