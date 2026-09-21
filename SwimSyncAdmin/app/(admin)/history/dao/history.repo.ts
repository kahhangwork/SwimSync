import { supabase } from "@/lib/supabase";
import { ROW_LIMIT, sgDayEnd, sgDayStart } from "../constants";

/**
 * The filtered audit_log read. Both filters are applied in the DATABASE so the
 * ROW_LIMIT cap bites AFTER filtering, not before.
 *
 * ⚠ The date bounds are spelled with an explicit +08:00 offset (§7.227,
 * BATCH_E_PLAN.md RISK 6). Do NOT rebuild either from a Date: a zoneless
 * `${date}T00:00:00` puts the day boundary at the VIEWER's midnight, and this
 * page exists to settle disputes.
 */
export function loadAuditLog(
  entityFilter: string,
  dateFrom: string,
  dateTo: string
) {
  let query = supabase
    .from("audit_log")
    .select(
      "id, created_at, actor_id, action, entity_type, entity_id, old_value, new_value, profiles(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);

  if (entityFilter !== "All") query = query.eq("entity_type", entityFilter);
  // A whole-day range on a timestamptz column: everything on `dateTo` too.
  if (dateFrom) query = query.gte("created_at", sgDayStart(dateFrom));
  if (dateTo) query = query.lte("created_at", sgDayEnd(dateTo));

  return query;
}
