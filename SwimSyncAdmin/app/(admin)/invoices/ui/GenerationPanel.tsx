"use client";

import { RefreshCw } from "lucide-react";
import { checkSgPhone } from "@/lib/sgPhone";
import { Button } from "@/components/Button";

/** The invoice generation + billing-schedule panel: the month picker + Generate
 *  button (generation slice), and the automatic-generation toggle, run day and
 *  PayNow proxy (tenant-billing slice). */
export function GenerationPanel({
  genMonth,
  setGenMonth,
  latestBillableMonth,
  generating,
  onGenerate,
  genResult,
  autoEnabled,
  togglingAuto,
  onToggleAuto,
  runDay,
  setRunDay,
  savingRunDay,
  onSaveRunDay,
  paynowUen,
  setPaynowUen,
  paynowMobile,
  setPaynowMobile,
  onSavePaynow,
  paynowSaved,
}: {
  genMonth: string;
  setGenMonth: (s: string) => void;
  latestBillableMonth: string;
  generating: boolean;
  onGenerate: () => void;
  genResult: string | null;
  autoEnabled: boolean | null;
  togglingAuto: boolean;
  onToggleAuto: () => void;
  runDay: number | null;
  setRunDay: (n: number) => void;
  savingRunDay: boolean;
  onSaveRunDay: (n: number) => void;
  paynowUen: string | null;
  setPaynowUen: (s: string) => void;
  paynowMobile: string | null;
  setPaynowMobile: (s: string) => void;
  onSavePaynow: (field: "paynow_uen" | "paynow_mobile", raw: string) => void;
  paynowSaved: string | null;
}) {
  return (
    <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">
            Billing month
          </label>
          {/* Capped at the last COMPLETED month. This is an affordance, not
              the guard — `max` constrains neither a programmatically-set
              value nor every browser, so the engine refuses it too. */}
          <input
            type="month"
            value={genMonth}
            max={latestBillableMonth}
            onChange={(e) => setGenMonth(e.target.value)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </div>
        <Button onClick={onGenerate} disabled={generating}>
          <RefreshCw className={`h-4 w-4 ${generating ? "animate-spin" : ""}`} />
          {generating ? "Generating…" : "Generate Invoices"}
        </Button>

        {/* Auto-generation toggle.
            `autoEnabled === null` means UNKNOWN, not off — a platform admin
            has no tenant, so loadTenant() returns before reading any setting.
            Rendering null as "off" (and `runDay ?? 7` as "day 7") presented
            invented values as this business's configuration; it only ever
            looked right because production happens to be false/7. */}
        <div className="ml-auto flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs font-semibold text-gray-700">
              Automatic monthly generation
            </div>
            <div className="text-[11px] text-gray-400">
              {autoEnabled === null
                ? "No business selected"
                : `Runs from day ${runDay ?? 7} for the previous month`}
            </div>
          </div>
          {/* shrink-0: this is a flex item next to a two-line label, and w-11
              is a flex BASIS, not a floor — without it the track squashes
              while the absolutely-positioned knob keeps its 20px offset, so
              the knob rides the edge or overhangs it. */}
          <button
            type="button"
            onClick={onToggleAuto}
            disabled={togglingAuto || autoEnabled === null}
            aria-label="Automatic monthly invoice generation"
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              autoEnabled === null
                ? "bg-gray-200"
                : autoEnabled
                  ? "bg-sky-500"
                  : "bg-gray-300"
            } disabled:opacity-50`}
            aria-pressed={!!autoEnabled}
          >
            <span
              className={`absolute top-0.5 left-0 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                autoEnabled ? "translate-x-[1.375rem]" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Run day. Only affects the automatic path, so it is greyed out (but
          still editable) when automatic generation is switched off. */}
      <div className="mt-3 flex items-center gap-2">
        <label
          htmlFor="run-day"
          className={`text-xs font-medium ${
            autoEnabled ? "text-gray-700" : "text-gray-400"
          }`}
        >
          Generate automatic invoices from day
        </label>
        {/* Blank rather than "7" when unknown — see the toggle above. A
            number shown here reads as this business's configured run day. */}
        <input
          id="run-day"
          type="number"
          min={1}
          max={28}
          value={runDay ?? ""}
          placeholder="—"
          disabled={savingRunDay || runDay === null}
          onChange={(e) => setRunDay(Number(e.target.value))}
          onBlur={(e) => onSaveRunDay(Number(e.target.value))}
          className="w-16 rounded-md border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
        />
        <span
          className={`text-xs ${autoEnabled ? "text-gray-500" : "text-gray-400"}`}
        >
          of the following month
          {!autoEnabled && " — no effect while automatic generation is off"}
        </span>
      </div>

      {/* PayNow proxy. The invoice QR is computed from these — no QR image
          is uploaded anywhere. UEN wins when both are set (a corporate
          account is guaranteed to get the reference on its statement; a
          personal mobile proxy is best-effort, and mobile-only is a fully
          supported setup — production's private coach runs on one). */}
      <div className="mt-4 border-t border-gray-100 pt-3">
        <div className="text-xs font-semibold text-gray-700 mb-1">
          PayNow details for invoice QR codes
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="paynow-uen" className="text-xs text-gray-500">
            UEN
          </label>
          <input
            id="paynow-uen"
            type="text"
            value={paynowUen ?? ""}
            placeholder="e.g. 201403121W"
            disabled={paynowUen === null}
            onChange={(e) => setPaynowUen(e.target.value)}
            onBlur={(e) => onSavePaynow("paynow_uen", e.target.value)}
            className="w-36 rounded-md border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
          />
          <label htmlFor="paynow-mobile" className="text-xs text-gray-500 ml-2">
            or mobile
          </label>
          <input
            id="paynow-mobile"
            type="text"
            value={paynowMobile ?? ""}
            placeholder="e.g. 91234567"
            disabled={paynowMobile === null}
            onChange={(e) => setPaynowMobile(e.target.value)}
            onBlur={(e) => onSavePaynow("paynow_mobile", e.target.value)}
            className="w-32 rounded-md border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
          />
          {(() => {
            const check = checkSgPhone(paynowMobile ?? "");
            return check.message ? (
              <span className="text-[11px] text-amber-600">{check.message}</span>
            ) : null;
          })()}
        </div>
        <p className="mt-1 text-[11px] text-gray-400">
          Invoices show a PayNow QR with the amount and reference locked in.
          A UEN (business account) is preferred when you have one — the
          reference then always reaches your bank statement. A personal
          mobile number works too; reference visibility depends on the bank.
        </p>
        {paynowSaved && (
          <p
            className={`mt-1 text-xs font-medium ${
              paynowSaved.startsWith("Error") ? "text-red-600" : "text-green-600"
            }`}
          >
            {paynowSaved}
          </p>
        )}
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Manual generation bills whatever attendance is marked for the chosen
        month (one invoice per parent, across all their children). It ignores
        the automatic on/off switch and never blocks the scheduled run.
      </p>
      {genResult && (
        <p
          className={`mt-2 text-sm font-medium ${
            genResult.startsWith("Error") ? "text-red-600" : "text-green-600"
          }`}
        >
          {genResult}
        </p>
      )}
    </div>
  );
}
