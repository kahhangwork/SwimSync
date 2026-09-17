import { todayInSg } from "@/lib/lessonDates";
import type { LessonLine, PayoutItem } from "./payoutItems";
import type { CoachRow } from "../types";

/**
 * todayInSg(), not the device's calendar. `new Date().getMonth()` is the
 * browser's month, and an admin on a laptop still set to another timezone gets
 * a different default period from the one the engine bills (§7.7).
 */
export function currentMonth(): string {
  return todayInSg().slice(0, 7);
}

/**
 * A negative wage line is a CLAWBACK, and it has to read as one. `S$-50.00` —
 * what toFixed() gives you — puts the sign where nobody looks; the minus goes
 * in front of the currency, as on a bank statement.
 */
export function money(amount: number): string {
  return `${amount < 0 ? "−" : ""}S$${Math.abs(amount).toFixed(2)}`;
}

/**
 * The small print on one lesson line: how the amount was arrived at, and which
 * month it corrects. An ADJUSTMENT carries no duration — it is a difference,
 * not a lesson length — so the minutes are omitted rather than rendered as
 * "— min", which reads as a lesson whose length nobody recorded.
 */
export function lineDetail(line: LessonLine): string {
  const parts: string[] = [];

  if (line.items.length > 1) {
    parts.push(`${line.items.length} entries`);
  } else if (line.items[0].basis === "flat") {
    parts.push("class flat rate");
  } else if (line.items[0].minutes != null) {
    parts.push(`${line.items[0].minutes} min`);
  }

  if (line.adjustedPeriods.length > 0) {
    parts.push(`correcting ${line.adjustedPeriods.join(", ")}`);
  }

  return parts.join(" · ");
}

/** One coaches row (with profiles + coach_rates embeds) -> the Rates table row. */
export function toCoachRow(c: any): CoachRow {
  // The rate IN EFFECT is the latest effective_from — rates are
  // effective-dated so a raise never reprices an earlier month.
  //
  // ⚠ FILTERED TO role='main' FIRST, AND THAT IS NOT COSMETIC. Since
  // 20260812000200 a coach can hold a SHADOW rate too, on its own
  // timeline. Sorting every row by effective_from and taking [0] — which
  // is what this did — makes the first shadow rate dated after a main
  // rate display as that coach's rate, while payroll pays the other one.
  const mainRates = (c.coach_rates ?? []).filter(
    (r: any) => (r.role ?? "main") === "main"
  );
  const shadowRates = (c.coach_rates ?? []).filter(
    (r: any) => r.role === "shadow"
  );
  const rates = mainRates.slice().sort((a: any, b: any) =>
    b.effective_from.localeCompare(a.effective_from)
  );
  const shadowSorted = shadowRates.slice().sort((a: any, b: any) =>
    b.effective_from.localeCompare(a.effective_from)
  );
  const prof = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
  return {
    id: c.id,
    name: prof?.full_name ?? "—",
    rate: rates[0]
      ? {
          amount: Number(rates[0].amount),
          unit_minutes: rates[0].unit_minutes,
          effective_from: rates[0].effective_from,
        }
      : null,
    shadowRate: shadowSorted[0]
      ? {
          amount: Number(shadowSorted[0].amount),
          unit_minutes: shadowSorted[0].unit_minutes,
          effective_from: shadowSorted[0].effective_from,
        }
      : null,
  };
}

/** A coach_payouts row's embedded items -> PayoutItem[] (amount numeric). */
export function toPayoutItems(p: any): PayoutItem[] {
  return (p.coach_payout_items ?? []).map((i: any) => ({
    id: i.id,
    lesson_session_id: i.lesson_session_id,
    class_title: i.class_title,
    session_date: i.session_date,
    basis: i.basis,
    minutes: i.minutes,
    amount: Number(i.amount),
    is_adjustment: i.is_adjustment,
    original_period: i.original_period,
  }));
}
