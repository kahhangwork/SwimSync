// The coach Settings tab's module-level constants (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H) — moved verbatim from app/(coach)/settings/index.tsx.

/** The admin panel is a SEPARATE deployment on its own domain — this screen is
 *  the Expo app, so a relative route would resolve inside the wrong site. */
export const ADMIN_PANEL_URL = "https://admin.swimsync.sg";
