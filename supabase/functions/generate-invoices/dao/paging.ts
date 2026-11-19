// The batched-read primitives of the billing engine, moved verbatim out of core.ts
// (EDGE_FUNCTIONS_REFACTOR_PLAN.md B2). readPaged / readAllIn are the §7.391 speed fix:
// keep them byte-for-byte.

import { IN_CHUNK, PAGE } from "../constants.ts";

// ── Batched reads (BILLING ENGINE SPEED, 2026-11-16) ───────────────────────
// The engine used to ask one question per CLASS (six queries each) and two per
// PARENT. Every question is a network round trip, and on prod a round trip
// cost ~300 ms (admin API in Vercel iad1, DB in ap-southeast-1), so October's
// run took 30+ s for 7 invoices. Each table is now read ONCE per tenant-month
// and grouped in memory; the per-class loop below receives the same rows it
// used to fetch, so nothing it computes can change.
//
// ⚠ IN_CHUNK — an .in() list rides the URL. Locally 200 uuids pass and 300 are
// refused with 414; prod's limit is not known, so 100 leaves room.
// ⚠ PAGING BY COUNT, NOT BY A SHORT PAGE. PostgREST silently caps a response
//   at max_rows. Stopping at "fewer rows than I asked for" would truncate if a
//   project's cap were ever set below the page size — a missing attendance row
//   is a missing line on an invoice. Every batched read asks for an exact count
//   and keeps reading until a page holds every remaining row.
// ⚠ KEYSET, NOT OFFSET. Pages continue from the last key (`key > last`), so a
//   row inserted mid-read (a coach marking while the run reads) can at most be
//   NOT SEEN YET — it can never shift an existing row off a page boundary, which
//   offset paging could.
// ⚠ A READ ERROR THROWS. The per-class reads these replace swallowed errors
//   into empty data, which in the worst case let a class with an unreadable
//   session list fall out of the gate and the month seal over it. Every batched
//   read happens before any invoice is written, so a throw costs a retry and
//   nothing else (index.ts records it as an error run).

// A supabase-js select built with { count: "exact" }, as readPaged uses it: keyset
// `.gt()`, then `.order()`, then `.limit()`, awaited for { data, error, count }. Typed
// STRUCTURALLY so every table's builder fits without an `any`, and GENERIC in its row:
// readPaged / readAllIn infer T from the builder, so a row's type is whatever the
// generated Database types say its `.select()` string returns — a misspelled or dropped
// column is a `deno check` error, not an `undefined` at billing time (§7.76). Don't pass
// T by hand: it is still checked (the builder must fit CountedQuery<T>, so T cannot name
// a column the select lacks), but it only restates — and can narrow — what inference
// already knows. Type-only — the emitted JS is unchanged.
type PageResult<R> = { data: R[] | null; error: { message: string } | null; count: number | null };
type CountedQuery<R> = {
  gt(column: string, value: string): CountedQuery<R>;
  order(column: string): { limit(count: number): PromiseLike<PageResult<R>> };
};

/** Every row of a counted query, keyset-paged by `orderKey` — a column that
 *  is unique within the query AND selected (the next page starts after it). */
export async function readPaged<T>(
  build: () => CountedQuery<T>,
  orderKey: string,
  what: string,
  /** Rows per request. Tests only — production uses PAGE. */
  pageSize: number = PAGE
): Promise<T[]> {
  const out: T[] = [];
  let last: string | null = null;
  for (;;) {
    let q = build();
    if (last !== null) q = q.gt(orderKey, last);
    const { data, error, count } = await q.order(orderKey).limit(pageSize);
    if (error) throw new Error(`${what}: ${error.message}`);
    // `count` is how many rows remain past `last`, so a page that holds that
    // many is the final one.
    if (count === null || count === undefined) {
      throw new Error(`${what}: no row count returned`);
    }
    const rows = (data ?? []) as Record<string, unknown>[];
    out.push(...(rows as T[]));
    if (rows.length >= count) return out;
    if (rows.length === 0) throw new Error(`${what}: ${count} rows reported but none returned`);
    const key = rows[rows.length - 1][orderKey];
    if (typeof key !== "string") throw new Error(`${what}: page key ${orderKey} not selected`);
    last = key;
  }
}

/** Every row matching an .in() over `ids`, chunked and paged. Empty ids → no request. */
export async function readAllIn<T>(
  ids: readonly string[],
  build: (chunk: string[]) => CountedQuery<T>,
  what: string
): Promise<T[]> {
  const unique = [...new Set(ids)];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const chunk = unique.slice(i, i + IN_CHUNK);
    out.push(...(await readPaged<T>(() => build(chunk), "id", what)));
  }
  return out;
}
