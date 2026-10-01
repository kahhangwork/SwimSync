// Test harness for the marking screen's save path (ATTENDANCE_SAVE_TESTS_PLAN.md, Step 1).
// Not a test file — jest's testMatch never runs it; the *.test.ts(x) files that wire it
// in do. One module-level log, `calls`, records every dao call, toast, confirm and
// leaveScreen IN ORDER, so an order assertion reads the log rather than comparing
// jest.fn call counts across mocks.
//
// ⚠ TYPE-ONLY imports of the dao modules. The mock surface is declared over
// `keyof typeof Repo` / `Rpc`, so a dao export added later without a default here
// fails `npm run typecheck` — not a test, at runtime, behind a spinner. A VALUE import
// of either module (or of @/lib/supabase) would build the real client: never add one.
//
// Wiring, the same in every file that uses this (paths relative to that file):
//   jest.mock("<rel>/dao/markAttendance.repo", () => require("<rel>/testing/saveHarness").repoMock);
//   jest.mock("<rel>/dao/markAttendance.rpc",  () => require("<rel>/testing/saveHarness").rpcMock);
//   jest.mock("@/store/useAppStore", () => ({ useAppStore: (sel: any) => sel(require("<rel>/testing/saveHarness").store) }));
//   jest.mock("@/lib/confirm", () => ({ confirmAction: (...a: any[]) => require("<rel>/testing/saveHarness").confirmAction(...a) }));
//   jest.mock("@/lib/supabase", () => require("<rel>/testing/saveHarness").supabaseTripwire);
import type * as Repo from "../dao/markAttendance.repo";
import type * as Rpc from "../dao/markAttendance.rpc";
import type { AttState, StudentRow } from "../types";

export type Call = { fn: string; args: unknown[] };
export const calls: Call[] = [];

type Impl = (...args: any[]) => unknown;

// ── Defaults — the REAL return shapes, read from dao/*.ts ──────────────────
// PostgREST builders resolve { data, error }. isMainOnSession resolves a BARE
// boolean (it wraps fetchIsMainOnSession); fetchFloor resolves null (the calendar
// rule); notifyCreditNotes resolves nothing.
const ok = (data: unknown = null) => async () => ({ data, error: null });

const repoDefaults: { [K in keyof typeof Repo]: Impl } = {
  loadClass: ok(null),
  loadMyCoach: ok({ id: "coach-1" }),
  loadSession: ok(null),
  loadMyRosterRow: ok(null),
  loadAttendance: ok([]),
  loadTrialBookings: ok([]),
  loadMakeupBookings: ok([]),
  loadCoachRecord: ok({ id: "coach-1" }),
  loadSessionId: ok(null),
  createSession: ok({ id: "sess-new" }),
  upsertAttendance: async () => ({ error: null }),
  deleteAbsences: async () => ({ error: null }),
  upsertAbsences: async () => ({ error: null }),
  insertAuditLog: async () => ({ error: null }),
};

const rpcDefaults: { [K in keyof typeof Rpc]: Impl } = {
  isActiveClassShadow: ok(false),
  sessionShadowCoaches: ok([]),
  fetchFloor: async () => null,
  isMainOnSession: async () => true,
  notifyCreditNotes: async () => undefined,
};

// Per-test replacements, cleared by resetHarness(). Recording stays in the wrapper,
// so an override can never silently stop a call reaching the log.
const overrides: Record<string, Impl> = {};

function recorded<D extends Record<string, Impl>>(defaults: D): { [K in keyof D]: jest.Mock } {
  const out = {} as { [K in keyof D]: jest.Mock };
  for (const name of Object.keys(defaults) as (keyof D & string)[]) {
    out[name] = jest.fn((...args: unknown[]) => {
      calls.push({ fn: name, args });
      return (overrides[name] ?? defaults[name])(...args);
    });
  }
  return out;
}

export const repoMock = recorded(repoDefaults);
export const rpcMock = recorded(rpcDefaults);

/** Replace one dao function's behaviour for the current test. */
export function when(
  name: keyof typeof Repo | keyof typeof Rpc,
  impl: Impl
): void {
  overrides[name] = impl;
}

// ── Store, confirm, leaveScreen ─────────────────────────────────────────────
export const showToast = jest.fn((...args: unknown[]) => {
  calls.push({ fn: "showToast", args });
});
export const store = { session: { id: "profile-1" }, showToast };

export const leaveScreen = jest.fn(() => {
  calls.push({ fn: "leaveScreen", args: [] });
});

export type ConfirmRecord = { title: string; message: string; onConfirm: () => void; label?: string };
export const confirms: ConfirmRecord[] = [];
/** Records the prompt and does NOT confirm. A test that wants it confirmed calls
 *  the recorded onConfirm itself — so "nothing applied until confirmed" is testable. */
export function confirmAction(title: string, message: string, onConfirm: () => void, label?: string) {
  calls.push({ fn: "confirmAction", args: [title, message] });
  confirms.push({ title, message, onConfirm, label });
}

/** A TRIPWIRE, not a seam: any path that reaches the real client throws, so an
 *  unmocked call can never talk to a database a local .env points at. */
export const supabaseTripwire = new Proxy(
  {},
  {
    get: (_t, p) => {
      if (p === "__esModule") return false;
      throw new Error(`test reached the real database client (.${String(p)}) — mock the dao seam`);
    },
  }
);

/** Call in every file's beforeEach. Clears the log, the confirm records and every
 *  override; mockClear (not mockReset) keeps the recording wrappers installed. */
export function resetHarness(): void {
  calls.length = 0;
  confirms.length = 0;
  for (const k of Object.keys(overrides)) delete overrides[k];
  for (const m of [...Object.values(repoMock), ...Object.values(rpcMock)]) m.mockClear();
  showToast.mockClear();
  leaveScreen.mockClear();
}

// ── Assertions that cannot pass vacuously ───────────────────────────────────
const WRITES = [
  "createSession",
  "upsertAttendance",
  "upsertAbsences",
  "deleteAbsences",
  "insertAuditLog",
  "notifyCreditNotes",
  "leaveScreen",
];

/** Nothing was written and the screen was not left. THROWS if no toast was shown:
 *  a guard test with no toast never reached the guard, and would pass for free. */
export function expectNoWrites(log: readonly Call[] = calls): void {
  if (!log.some((c) => c.fn === "showToast")) {
    throw new Error("expectNoWrites: no toast in the log — the guard was never reached");
  }
  expect(log.map((c) => c.fn).filter((fn) => WRITES.includes(fn))).toEqual([]);
}

/** `id` appears in no recorded call's arguments, anywhere. */
export function expectIdNeverSent(id: string, log: readonly Call[] = calls): void {
  // The fn name rides along so a red names the call that sent it.
  for (const c of log) expect(`${c.fn}(${JSON.stringify(c.args)})`).not.toContain(id);
}

/** Index of the FIRST call to `fn` in the log, failing loudly if it never happened. */
export function firstIndex(fn: string, log: readonly Call[] = calls): number {
  const i = log.findIndex((c) => c.fn === fn);
  if (i < 0) throw new Error(`firstIndex: ${fn} was never called`);
  return i;
}

export function calledFns(log: readonly Call[] = calls): string[] {
  return log.map((c) => c.fn);
}

export function toasts(log: readonly Call[] = calls): unknown[][] {
  return log.filter((c) => c.fn === "showToast").map((c) => c.args);
}

export function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// ── Fixtures ────────────────────────────────────────────────────────────────
export function student(id: string, full_name: string, extra: Partial<StudentRow> = {}): StudentRow {
  return { id, full_name, ...extra };
}

export function att(top: AttState["top"], sub: string | null = null): AttState {
  return { top, sub };
}
