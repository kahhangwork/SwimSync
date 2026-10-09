// The engine's clock — read from the DATABASE, not the edge runtime.
//
// Plan: docs/plans/PIN_DRIVER_CLOCK_PLAN.md (D3, "The engine reads the DB
// clock"). The handler asks Postgres for app_now() over RPC and hands that
// instant to generateInvoices as opts.now. On prod app_now() IS now() (nothing
// there sets swimsync.now), so billing behaves exactly as before. Locally,
// run-all-drivers.sh --now pins the database, and through this one read the
// engine joins the browser, PostgREST and the drivers' SQL on the same moment.
//
// Load-bearing properties (⚠ RISK 1):
//   • ALWAYS overwrites opts.now. A JSON body can never carry a Date, and
//     core.ts's `instanceof Date` guard keeps it that way; this module must not
//     open a path from the wire to the clock.
//   • An Invalid Date is not a date. `new Date("junk") instanceof Date` is
//     true and would sail through core.ts into previousBillingMonth (§7.357).
//   • Fail CLOSED on prod if the database disagrees with the wall clock. A pin
//     cannot exist there (three locks, 20261009000200), so a skew can only be a
//     parse/offset bug — the §7.7 family, which could move the month-not-ended
//     and run-day guards by a day. Keyed on SUPABASE_URL's host, structurally,
//     not on an env flag someone must remember.
//   • One retry, then throw: an unscoped run records no error row
//     (toErrorRows needs a tenant_id), so a blip would otherwise be visible
//     only in the function logs.

/** The slice of a Supabase client this module needs — lets tests stub it. */
export type ClockRpc = {
  rpc: (fn: "app_now") => PromiseLike<{ data: unknown; error: unknown }>;
};

export const MAX_PROD_SKEW_MS = 120_000;
export const RETRY_BACKOFF_MS = 500;

const LOCAL_HOSTS = new Set(["kong", "localhost", "127.0.0.1", "host.docker.internal"]);

/** True for a local stack's API URL — the only place a pin can exist. */
export function isLocalSupabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Parse app_now()'s RPC value. Throws unless it is a string that parses to a
 *  finite instant — PostgREST returns "2026-09-30T23:59:00.123456+00:00". */
export function parseDbNow(data: unknown): Date {
  if (typeof data !== "string") {
    throw new Error(`could not read the database clock: expected a timestamp string, got ${data === null ? "null" : typeof data}`);
  }
  const d = new Date(data);
  if (!Number.isFinite(d.getTime())) {
    throw new Error(`could not read the database clock: unparseable timestamp "${data.slice(0, 64)}"`);
  }
  return d;
}

type ClockDeps = {
  supabaseUrl: string | undefined;
  wallNow?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/** The database's "now" — app_now() — as a Date. Throws on an RPC error after
 *  one retry, on an unparseable value, and (off a local stack) on a skew of
 *  more than MAX_PROD_SKEW_MS from the wall clock. */
export async function dbNow(client: ClockRpc, deps: ClockDeps): Promise<Date> {
  const wallNow = deps.wallNow ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let res = await client.rpc("app_now");
  if (res.error) {
    await sleep(RETRY_BACKOFF_MS);
    res = await client.rpc("app_now");
  }
  if (res.error) {
    const msg = (res.error as { message?: string }).message ?? String(res.error);
    throw new Error(`could not read the database clock: ${msg}`);
  }

  const d = parseDbNow(res.data);
  if (!isLocalSupabaseUrl(deps.supabaseUrl)) {
    const skew = Math.abs(d.getTime() - wallNow());
    if (skew > MAX_PROD_SKEW_MS) {
      throw new Error(
        `could not read the database clock: it is ${Math.round(skew / 1000)}s from the wall clock ` +
          `(limit ${MAX_PROD_SKEW_MS / 1000}s off a local stack)`
      );
    }
  }
  return d;
}

/** opts with `now` replaced by the database's clock — ALWAYS replaced, so a
 *  request body's `now` (never a Date over JSON anyway) is discarded. */
export async function withDbNow<T extends { now?: Date }>(
  opts: T,
  client: ClockRpc,
  deps: ClockDeps
): Promise<T> {
  return { ...opts, now: await dbNow(client, deps) };
}
