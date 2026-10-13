"use client";

import { checkSgPhone } from "@/lib/sgPhone";
import { SectionHeading } from "@/components/ui/SectionHeading";

/** The business's billing SETTINGS — the automatic-generation toggle, its run
 *  day and the PayNow proxy (tenant-billing slice). Moved off the Generate card
 *  in UI restyle 5.1 (BACKLOG S10: settings out of working pages) — a MOVE: every
 *  handler and the field it writes is exactly what GenerationPanel had. */
export function BillingSettingsCard({
  autoEnabled,
  togglingAuto,
  onToggleAuto,
  runDay,
  setRunDay,
  savingRunDay,
  runDayMessage,
  onSaveRunDay,
  paynowUen,
  setPaynowUen,
  paynowMobile,
  setPaynowMobile,
  onSavePaynow,
  paynowSaved,
}: {
  autoEnabled: boolean | null;
  togglingAuto: boolean;
  onToggleAuto: () => void;
  runDay: number | null;
  setRunDay: (n: number) => void;
  savingRunDay: boolean;
  runDayMessage: string | null;
  onSaveRunDay: (n: number) => void;
  paynowUen: string | null;
  setPaynowUen: (s: string) => void;
  paynowMobile: string | null;
  setPaynowMobile: (s: string) => void;
  onSavePaynow: (field: "paynow_uen" | "paynow_mobile", raw: string) => void;
  paynowSaved: string | null;
}) {
  return (
    <div data-testid="billing-settings" className="mt-5 rounded-card border border-border bg-surface p-4">
      <SectionHeading>Billing settings</SectionHeading>

      <div className="mt-3 flex items-center gap-3">
        {/* Auto-generation toggle.
            `autoEnabled === null` means UNKNOWN, not off — a platform admin
            has no tenant, so loadTenant() returns before reading any setting.
            Rendering null as "off" (and `runDay ?? 7` as "day 7") presented
            invented values as this business's configuration; it only ever
            looked right because production happens to be false/7. */}
        {/* shrink-0: this is a flex item next to a two-line label, and w-11
            is a flex BASIS, not a floor — without it the track squashes
            while the absolutely-positioned knob keeps its 20px offset, so
            the knob rides the edge or overhangs it. */}
        <button
          type="button"
          onClick={onToggleAuto}
          disabled={togglingAuto || autoEnabled === null}
          aria-label="Automatic monthly invoice generation"
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
            autoEnabled === null
              ? "bg-selected"
              : autoEnabled
                ? "bg-primary"
                : "bg-border-strong"
          } disabled:cursor-not-allowed disabled:opacity-50`}
          aria-pressed={!!autoEnabled}
        >
          <span
            className={`absolute top-0.5 left-0 h-5 w-5 rounded-full bg-surface transition-transform ${
              autoEnabled ? "translate-x-[1.375rem]" : "translate-x-0.5"
            }`}
          />
        </button>
        <div>
          <div className="text-body font-medium text-ink">
            Automatic monthly generation
          </div>
          <div className="text-label font-normal text-ink-muted">
            {autoEnabled === null
              ? "No business selected"
              : `Runs from day ${runDay ?? 7} for the previous month`}
          </div>
        </div>
      </div>

      {/* Run day. Only affects the automatic path, so it is greyed out (but
          still editable) when automatic generation is switched off. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label
          htmlFor="run-day"
          className={`text-body ${
            autoEnabled ? "text-ink-secondary" : "text-ink-muted"
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
          className="h-9 w-16 rounded-control border border-border-strong bg-surface px-2 text-body text-ink focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary disabled:bg-status-neutral-bg disabled:text-ink-muted"
        />
        <span className="text-body text-ink-muted">
          of each month
          {!autoEnabled && " — no effect while automatic generation is off"}
        </span>
      </div>
      {/* A refused save is said out loud; the input already shows the STORED
          day (useTenantBilling re-reads it), not the rejected one. */}
      {runDayMessage && (
        <p id="run-day-message" className="mt-1 text-body font-medium text-status-danger-text">
          {runDayMessage}
        </p>
      )}

      {/* PayNow proxy. The invoice QR is computed from these — no QR image
          is uploaded anywhere. UEN wins when both are set (a corporate
          account is guaranteed to get the reference on its statement; a
          personal mobile proxy is best-effort, and mobile-only is a fully
          supported setup — production's private coach runs on one). */}
      <div className="mt-4 border-t border-divider pt-3">
        <div className="text-body font-medium text-ink mb-1">
          PayNow details for invoice QR codes
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="paynow-uen" className="text-body text-ink-secondary">
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
            className="h-9 w-36 rounded-control border border-border-strong bg-surface px-2 text-body text-ink placeholder:text-ink-muted focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary disabled:bg-status-neutral-bg disabled:text-ink-muted"
          />
          <label htmlFor="paynow-mobile" className="text-body text-ink-secondary ml-2">
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
            className="h-9 w-32 rounded-control border border-border-strong bg-surface px-2 text-body text-ink placeholder:text-ink-muted focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary disabled:bg-status-neutral-bg disabled:text-ink-muted"
          />
          {(() => {
            const check = checkSgPhone(paynowMobile ?? "");
            return check.message ? (
              <span className="text-label text-status-warning-text">{check.message}</span>
            ) : null;
          })()}
        </div>
        <p className="mt-1 text-label font-normal text-ink-muted">
          Invoices show a PayNow QR with the amount and reference locked in.
          A UEN (business account) is preferred when you have one — the
          reference then always reaches your bank statement. A personal
          mobile number works too; reference visibility depends on the bank.
        </p>
        {paynowSaved && (
          <p
            className={`mt-1 text-body font-medium ${
              paynowSaved.startsWith("Error") ? "text-status-danger-text" : "text-status-success-text"
            }`}
          >
            {paynowSaved}
          </p>
        )}
      </div>
    </div>
  );
}
