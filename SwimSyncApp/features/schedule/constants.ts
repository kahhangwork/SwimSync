// The Schedule tab's query constants (COACH_SCHEDULE_REFACTOR_PLAN.md, Stage 1) —
// moved verbatim from app/(coach)/schedule/index.tsx, comments included.

/**
 * PostgREST caps every response at `max_rows = 1000` (supabase/config.toml) and
 * does it SILENTLY — past the cap you get fewer rows, not an error. An
 * under-reported NEEDS MARKING list looks exactly like being up to date, which
 * is the worst possible failure for a screen whose whole job is to stop a
 * lesson going unbilled. So ask for a bound BELOW the cap and treat hitting it
 * as a condition to shout about (see `truncated`).
 *
 * Do not assume this is unreachable: `markable_floor` falls back to the
 * tenant's `created_at` when a business has NEVER sealed a month, so a school
 * onboarded months ago that has not billed has a floor that far back.
 */
export const ROW_LIMIT = 900;

/**
 * The class columns every card is built from. A COVERED class is fetched with
 * the same shape as an owned one — the substitute needs the title, the times
 * and the location just as much, and `classes_select` now returns it to them
 * (`coach_rostered_in_class`, 20260811000200).
 */
export const CLASS_SELECT = `
        id,
        title,
        day_of_week,
        start_time,
        end_time,
        location_id,
        locations(name),
        student_class_enrolments(student_id, is_active, enrolled_at, unenrolled_at)
      `;
