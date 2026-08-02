// Supabase Edge Function: public-invoice
//
// Thin HTTP wrapper over core.ts: CORS, rate limiting, and the ONE shared
// 404. verify_jwt = false (config.toml) — the 128-bit invoice token is the
// access control; there is deliberately no other auth (see core.ts header
// for why this is not an anon RPC).
//
//   GET  ?token=<32 hex>            → the public invoice shape
//   POST {"token": "...", "action": "claim"} → parent's "I've paid" stamp

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { claimInvoice, lookupInvoice } from "./core.ts";

const ALLOWED_ORIGINS = new Set([
  "https://swimsync.sg",
  "https://www.swimsync.sg",
  "http://localhost:8081",
  "http://127.0.0.1:8081",
]);

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://swimsync.sg",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ⚠ RISK 3: every not-found path funnels through THIS response — unknown
// token, malformed token, refused claim. One body, no oracle.
function notFound(cors: Record<string, string>) {
  return json({ error: "not_found" }, 404, cors);
}

// In-memory per-IP sliding window. Resets per isolate, which is
// proportionate: the real guard is token entropy; this only blunts bursts.
const WINDOW_MS = 60_000;
const WINDOW_LIMIT = 30;
const hits = new Map<string, { n: number; start: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.start > WINDOW_MS) {
    hits.set(ip, { n: 1, start: now });
    return false;
  }
  h.n += 1;
  return h.n > WINDOW_LIMIT;
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin") ?? "");
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return json({ error: "rate_limited" }, 429, cors);
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("token") ?? "";
    const invoice = await lookupInvoice(db, token);
    return invoice ? json(invoice, 200, cors) : notFound(cors);
  }

  if (req.method === "POST") {
    let body: { token?: string; action?: string } = {};
    try {
      body = await req.json();
    } catch {
      return notFound(cors);
    }
    if (body.action !== "claim") return notFound(cors);
    const claimed = await claimInvoice(db, body.token ?? "");
    return claimed ? json({ ok: true, ...claimed }, 200, cors) : notFound(cors);
  }

  return json({ error: "method_not_allowed" }, 405, cors);
});
