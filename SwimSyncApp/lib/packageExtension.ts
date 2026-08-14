// The loud/acknowledged state of a package's public-holiday extension.
// Twin of SwimSyncAdmin/lib/packageExtension.ts — the parent surface reads its
// own ack high-water (ph_ack_weeks_parent).
//
// "loud"  — the extension exceeds what the parent acknowledged → attention card
// "quiet" — extended, but acknowledged → a calm permanent note
// "none"  — no holiday extension

export type ExtensionState = "loud" | "quiet" | "none";

export function packageExtensionState(
  extWeeks: number,
  ackWeeks: number
): ExtensionState {
  if (extWeeks <= 0) return "none";
  return extWeeks > ackWeeks ? "loud" : "quiet";
}
