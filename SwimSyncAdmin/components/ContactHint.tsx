import type { ContactCheck } from "@/lib/sgPhone";

/**
 * The advisory line under a contact field.
 *
 * ⚠ RENDER-ONLY, AND DELIBERATELY NOT WIRED TO ANY SUBMIT. It reports what
 * `checkSgPhone`/`checkEmail` think and nothing else — no caller may refuse a
 * save because of it. The admin is usually typing the only number a family
 * actually gave them, so the product's job is to say "this probably won't
 * match", not to withhold the record. Where a contact field is REQUIRED (the
 * two create forms), that requirement is a separate, existing guard on its own
 * submit button — its *shape* is never a precondition. See lib/sgPhone.ts.
 *
 * Shared by the Students and Trials pages rather than duplicated: unlike
 * lessonDates.ts there is no cross-project boundary here, so one component in
 * components/ is simply the normal arrangement.
 */
export function ContactHint({ check }: { check: ContactCheck }) {
  if (check.level === "ok" || !check.message) return null;
  return (
    <p
      className={`mt-1 text-[11px] ${
        check.level === "warn" ? "text-amber-700" : "text-gray-500"
      }`}
    >
      {check.message}
    </p>
  );
}
