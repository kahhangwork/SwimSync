import { useState } from "react";
import * as repo from "../dao/wages.repo";

// The inline rate editor on the Rates table. Takes the spine's tenantId,
// loadCoaches (a save is proven by a reload) and the shared busy/message setters.
export function useRateEditor(
  tenantId: string | null,
  loadCoaches: (tid: string) => Promise<void>,
  setBusy: (b: boolean) => void,
  setMessage: (m: string | null) => void
) {
  const [rateFor, setRateFor] = useState<string | null>(null);
  const [rateAmount, setRateAmount] = useState("");
  const [rateUnit, setRateUnit] = useState("60");
  const [rateFrom, setRateFrom] = useState("");
  /** Which rate the editor is writing. Sent explicitly on the insert. */
  const [rateRole, setRateRole] = useState<"main" | "shadow">("main");

  async function handleSaveRate(coachId: string) {
    // An EMPTY amount must not save. Number("") is 0, which is finite and >= 0,
    // so a blank field would silently create a $0 rate — and a $0 rate is worse
    // than no rate: the coach reads as "on payroll" and earns nothing.
    if (rateAmount.trim() === "" || !rateFrom) {
      setMessage("Enter a rate amount and the date it takes effect.");
      return;
    }
    const amount = Number(rateAmount);
    const unit = Number(rateUnit);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(unit) || unit <= 0) {
      setMessage("Rate and minutes must both be greater than zero.");
      return;
    }
    setBusy(true);
    // INSERT, never UPDATE — a new effective-dated row. Editing the old one in
    // place would reprice every month it had already covered.
    // ⚠ role IS SENT EXPLICITLY, never left to the column default. The default
    // is 'main', so a shadow rate saved without it becomes a second main rate
    // and the two race on effective_from.
    const { error } = await repo.insertCoachRate({
      coach_id: coachId,
      amount,
      unit_minutes: unit,
      effective_from: rateFrom,
      role: rateRole,
    });
    setBusy(false);
    if (error) {
      setMessage(`Could not save rate: ${error.message}`);
      return;
    }
    setRateFor(null);
    setRateAmount("");
    setRateFrom("");
    if (tenantId) await loadCoaches(tenantId);
  }

  return {
    rateFor, setRateFor,
    rateAmount, setRateAmount,
    rateUnit, setRateUnit,
    rateFrom, setRateFrom,
    rateRole, setRateRole,
    handleSaveRate,
  };
}
