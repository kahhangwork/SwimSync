"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";

/**
 * Coach wages — the other half of the billing loop.
 *
 * SwimSync tracked every dollar coming IN from parents and nothing going OUT to
 * coaches, so the moment a coach is not the business owner, payroll is a
 * spreadsheet rebuilt by hand from attendance this app already holds.
 *
 * A coach appears here only if they HAVE A RATE. That is how a private coach
 * falls out of payroll without any private-vs-school branch: their income is
 * their parents' invoices, and there is nobody upstream to pay them.
 *
 * DRAFT payouts rebuild on every run — ordinary late corrections just flow in.
 * PAID ones freeze, because money has left the bank and the record has to
 * reconcile against a statement; a later correction to a frozen month appears
 * as an adjustment on the next one.
 */

type CoachRow = {
  id: string;
  name: string;
  rate: { amount: number; unit_minutes: number; effective_from: string } | null;
};

type PayoutRow = {
  id: string;
  coach_id: string;
  coach_name: string;
  gross_amount: number;
  status: "draft" | "paid";
  items: number;
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function WagesPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [rainPays, setRainPays] = useState(false);
  const [runDay, setRunDay] = useState(15);
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [period, setPeriod] = useState(currentMonth());
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Rate editor
  const [rateFor, setRateFor] = useState<string | null>(null);
  const [rateAmount, setRateAmount] = useState("");
  const [rateUnit, setRateUnit] = useState("60");
  const [rateFrom, setRateFrom] = useState("");

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", auth.user.id)
        .maybeSingle();
      if (!profile?.tenant_id) return;
      setTenantId(profile.tenant_id);

      const { data: t } = await supabase
        .from("tenants")
        .select("rain_pays_coach, wage_run_day")
        .eq("id", profile.tenant_id)
        .maybeSingle();
      setRainPays(t?.rain_pays_coach ?? false);
      setRunDay(t?.wage_run_day ?? 15);

      await loadCoaches(profile.tenant_id);
    })();
  }, []);

  async function loadCoaches(tid: string) {
    const { data } = await supabase
      .from("coaches")
      .select("id, profiles(full_name), coach_rates(amount, unit_minutes, effective_from)")
      .eq("tenant_id", tid);

    setCoaches(
      (data ?? []).map((c: any) => {
        // The rate IN EFFECT is the latest effective_from — rates are
        // effective-dated so a raise never reprices an earlier month.
        const rates = (c.coach_rates ?? []).slice().sort((a: any, b: any) =>
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
        };
      })
    );
  }

  async function loadPayouts() {
    if (!tenantId) return;
    const { data } = await supabase
      .from("coach_payouts")
      .select("id, coach_id, gross_amount, status, coach_payout_items(id)")
      .eq("tenant_id", tenantId)
      .eq("period_month", period);

    setPayouts(
      (data ?? []).map((p: any) => ({
        id: p.id,
        coach_id: p.coach_id,
        coach_name: coaches.find((c) => c.id === p.coach_id)?.name ?? "—",
        gross_amount: Number(p.gross_amount),
        status: p.status,
        items: (p.coach_payout_items ?? []).length,
      }))
    );
  }

  useEffect(() => {
    if (tenantId && coaches.length) loadPayouts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, period, coaches.length]);

  async function handleRun() {
    if (!tenantId) return;
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.rpc("generate_coach_payouts", {
      p_tenant_id: tenantId,
      p_period_month: period,
    });
    setBusy(false);
    if (error) {
      setMessage(`Could not run payroll: ${error.message}`);
      return;
    }
    await loadPayouts();
    setMessage("Payroll calculated. Draft payouts recalculate every run.");
  }

  async function handleMarkPaid(id: string) {
    setBusy(true);
    const { error } = await supabase.rpc("mark_payout_paid", { p_payout_id: id });
    setBusy(false);
    if (error) {
      setMessage(`Could not mark paid: ${error.message}`);
      return;
    }
    await loadPayouts();
    setMessage(
      "Marked paid and frozen. A later correction to this month becomes an adjustment on the next one."
    );
  }

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
    const { error } = await supabase.from("coach_rates").insert({
      coach_id: coachId,
      amount,
      unit_minutes: unit,
      effective_from: rateFrom,
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

  async function updateTenant(patch: Record<string, unknown>) {
    if (!tenantId) return;
    await supabase.from("tenants").update(patch).eq("id", tenantId);
  }

  if (!tenantId) {
    return (
      <div>
        <PageHeader title="Coach Wages" subtitle="Pay your coaches from attendance" />
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-gray-600">
          Wages are run per business, and your account is not attached to one.
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Coach Wages"
        subtitle="Calculated from the lessons your coaches actually taught"
      />

      {/* Policy */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Policy</h2>
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={rainPays}
              onChange={async (e) => {
                setRainPays(e.target.checked);
                await updateTenant({ rain_pays_coach: e.target.checked });
              }}
            />
            Pay coaches for lessons cancelled by rain
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            Pay coaches on day
            <input
              type="number"
              min={1}
              max={28}
              value={runDay}
              onChange={(e) => setRunDay(Number(e.target.value))}
              onBlur={async () => {
                const v = Math.min(28, Math.max(1, Math.trunc(runDay)));
                setRunDay(v);
                await updateTenant({ wage_run_day: v });
              }}
              className="w-16 rounded-lg border border-gray-200 px-2 py-1"
            />
            of the month
          </label>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          A lesson pays when at least one student attended. Everyone absent
          doesn&rsquo;t pay; a lesson the coach cancelled never does. Rain
          follows the setting above, and any single session can be overridden.
        </p>
      </div>

      {/* Rates */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-gray-900">Rates</h2>
        <p className="mb-3 text-xs text-gray-500">
          A coach with no rate isn&rsquo;t on payroll — which is right for a
          private coach, whose income is their parents&rsquo; invoices. Saving a
          rate adds a new dated rate rather than editing the old one, so past
          months keep the rate they were actually worked at.
        </p>
        <Table>
          <Thead>
            <Th>Coach</Th>
            <Th>Current rate</Th>
            <Th>In effect from</Th>
            <Th>Actions</Th>
          </Thead>
          <Tbody>
            {coaches.map((c) => (
              <Tr key={c.id}>
                <Td>{c.name}</Td>
                <Td>
                  {c.rate
                    ? `S$${c.rate.amount.toFixed(2)} per ${c.rate.unit_minutes} min`
                    : "Not on payroll"}
                </Td>
                <Td>{c.rate?.effective_from ?? "—"}</Td>
                <Td>
                  {rateFor === c.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="30.00"
                        value={rateAmount}
                        onChange={(e) => setRateAmount(e.target.value)}
                        className="w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm"
                      />
                      <span className="text-xs text-gray-500">per</span>
                      <input
                        type="number"
                        value={rateUnit}
                        onChange={(e) => setRateUnit(e.target.value)}
                        className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-sm"
                      />
                      <span className="text-xs text-gray-500">min, from</span>
                      <input
                        type="date"
                        value={rateFrom}
                        onChange={(e) => setRateFrom(e.target.value)}
                        className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
                      />
                      <button
                        onClick={() => handleSaveRate(c.id)}
                        disabled={busy}
                        className="rounded-lg bg-sky-500 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setRateFor(null)}
                        className="text-sm text-gray-500"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setRateFor(c.id);
                        setRateAmount(c.rate ? String(c.rate.amount) : "");
                        setRateUnit(String(c.rate?.unit_minutes ?? 60));
                        setRateFrom("");
                      }}
                      className="text-sm font-medium text-sky-600 underline"
                    >
                      {c.rate ? "Change rate" : "Set a rate"}
                    </button>
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>

      {/* Payroll run */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">
              Month
            </label>
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={handleRun}
            disabled={busy}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
          >
            {busy ? "Working…" : "Calculate payroll"}
          </button>
        </div>

        {message && (
          <div className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">
            {message}
          </div>
        )}

        {payouts.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">
            No payouts for this month yet.
          </p>
        ) : (
          <Table>
            <Thead>
              <Th>Coach</Th>
              <Th>Lessons</Th>
              <Th>Amount</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </Thead>
            <Tbody>
              {payouts.map((p) => (
                <Tr key={p.id}>
                  <Td>{p.coach_name}</Td>
                  <Td>{p.items}</Td>
                  <Td>S${p.gross_amount.toFixed(2)}</Td>
                  <Td>
                    <span
                      className={
                        p.status === "paid"
                          ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
                          : "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
                      }
                    >
                      {p.status === "paid" ? "Paid" : "Draft"}
                    </span>
                  </Td>
                  <Td>
                    {p.status === "draft" ? (
                      <button
                        onClick={() => handleMarkPaid(p.id)}
                        disabled={busy}
                        className="text-sm font-medium text-sky-600 underline disabled:opacity-50"
                      >
                        Mark paid
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">Frozen</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </div>
    </div>
  );
}
