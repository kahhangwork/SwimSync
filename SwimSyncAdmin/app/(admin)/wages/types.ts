import type { LessonLine, PayoutSummary } from "./domain/payoutItems";

export type Rate = { amount: number; unit_minutes: number; effective_from: string };

export type CoachRow = {
  id: string;
  name: string;
  /** The MAIN rate in force — what they are paid for a lesson they teach. */
  rate: Rate | null;
  /** The SHADOW rate in force, on its own timeline. Null is the ordinary case
   *  and is NOT missing setup — most coaches never shadow anything. It becomes
   *  a problem only once they are assigned as a class shadow, and payroll
   *  refuses loudly then rather than falling back to the main rate. */
  shadowRate: Rate | null;
};

export type PayoutRow = {
  id: string;
  coach_id: string;
  coach_name: string;
  gross_amount: number;
  status: "draft" | "paid";
  /** One entry per LESSON, each summing the items behind it. */
  lines: LessonLine[];
  summary: PayoutSummary;
  /** False when the stored gross and the breakdown disagree — surfaced, not hidden. */
  grossOk: boolean;
};
