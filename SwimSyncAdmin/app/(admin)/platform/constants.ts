// Module-level constants of the Platform page, moved verbatim at Stage 1 of
// docs/refactor/PLATFORM_REFACTOR_PLAN.md. Feature root, not lib/: nothing
// outside this page reads them (playbook §1).

/** PostgREST caps every fetch at max_rows (1000); a search must be pushed into
 *  the DB or it only sees the first 1000 memberships (⚠ RISK 3). */
export const ROW_LIMIT = 1000;
