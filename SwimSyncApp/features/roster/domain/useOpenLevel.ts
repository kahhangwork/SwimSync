// Which student's level curriculum is expanded on the roster — poolside
// reference. The one pure-UI state on the screen (COACH_ROSTER_REFACTOR_PLAN.md,
// Stage 4), moved verbatim; the route passes both names to ui/ unchanged.
import { useState } from "react";

export function useOpenLevel() {
  // Which student's level curriculum is expanded — poolside reference.
  const [openLevelFor, setOpenLevelFor] = useState<string | null>(null);
  return { openLevelFor, setOpenLevelFor };
}
