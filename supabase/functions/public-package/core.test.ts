// Integration + serializer tests for public-package. Runs against the LOCAL
// stack via generate-invoices' test.sh (which exports SUPABASE_URL +
// SERVICE_ROLE_KEY and includes this file).
//
// ⚠ RISK 5 / RISK 9 pins live here:
//   • the EXACT response key set — a new key is a test failure, not a leak;
//   • claim is null for everything but an unclaimed PENDING offer (cancelled /
//     active / already-claimed), so a stale WhatsApp link can never re-arm a
//     payment;
//   • a suspended business is the same not-found as an unknown token.

import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { newScenario } from "../generate-invoices/test-helpers.ts";
import {
  claimPackage,
  lookupPackage,
  serializePublicPackage,
  validUntilPreview,
} from "./core.ts";

// ── Serializer + preview (pure) ──────────────────────────────────────────────

const ROW = {
  reference_number: "PKG-2026-0001",
  total_value: 320,
  name: "8 Group Lessons",
  lesson_count: 8,
  rate_per_lesson: 40,
  start_date: "2026-09-01",
  validity_weeks: 4,
  status: "pending",
  paid_claimed_at: null,
  tenants: { display_name: "Swim A", paynow_uen: null, paynow_mobile: "91234567" },
};

Deno.test("serializer: the public key set is EXACT — a new key is a failure", () => {
  assertEquals(Object.keys(serializePublicPackage(ROW)).sort(), [
    "amount",
    "business_name",
    "lesson_count",
    "package_name",
    "paid_claimed_at",
    "paynow_mobile",
    "paynow_uen",
    "rate",
    "reference",
    "start_date",
    "status",
    "valid_until_preview",
  ]);
});

Deno.test("serializer: no parent/child/UUID fields leak; preview rides along", () => {
  const p = serializePublicPackage(ROW);
  assertEquals(p.valid_until_preview, "2026-09-29"); // 2026-09-01 + 4 weeks
  assertEquals(p.amount, 320);
  assertEquals(p.package_name, "8 Group Lessons");
});

Deno.test("preview: null start or weeks yields null (a parent's own request)", () => {
  assertEquals(validUntilPreview(null, 4), null);
  assertEquals(validUntilPreview("2026-09-01", null), null);
  assertEquals(validUntilPreview("2026-09-01", 0), null);
});

Deno.test("serializer: survives the PostgREST array-embed shape", () => {
  const p = serializePublicPackage({ ...ROW, tenants: [ROW.tenants] });
  assertEquals(p.business_name, "Swim A");
});

// ── Against the local stack ─────────────────────────────────────────────────

async function offerFixture(startDate = "2026-09-01") {
  const s = await newScenario();
  const { data: prod, error: prodErr } = await s.db
    .from("package_products")
    .insert({
      tenant_id: s.tenantId,
      name: "8 Group Lessons",
      category_id: s.categoryId,
      lesson_count: 8,
      rate_per_lesson: 40,
      validity_months: 12,
      validity_weeks: 4,
    })
    .select("id")
    .single();
  if (prodErr || !prod) throw new Error(`fixture product: ${prodErr?.message}`);

  const { data, error } = await s.db
    .from("parent_packages")
    .insert({
      tenant_id: s.tenantId,
      parent_id: s.parentId,
      product_id: prod.id,
      status: "pending",
      start_date: startDate,
      offered_by: s.coachProfileId,
      offered_at: new Date().toISOString(),
    })
    .select("id, public_token, reference_number")
    .single();
  if (error || !data) throw new Error(`fixture offer: ${error?.message}`);
  return {
    s,
    id: data.id as string,
    token: data.public_token as string,
    ref: data.reference_number as string,
  };
}

Deno.test("lookup: a real token returns the offer; the trigger's ref rides along", async () => {
  const { s, token, ref } = await offerFixture();
  try {
    const p = await lookupPackage(s.db, token);
    assertNotEquals(p, null);
    assertEquals(p!.amount, 320);
    assertEquals(p!.reference, ref);
    assertEquals(p!.status, "pending");
    assertEquals(p!.valid_until_preview, "2026-09-29");
  } finally {
    await s.teardown();
  }
});

Deno.test("lookup: malformed and unknown tokens are both null — no oracle", async () => {
  const { s } = await offerFixture();
  try {
    assertEquals(await lookupPackage(s.db, "not-a-token"), null);
    assertEquals(await lookupPackage(s.db, ""), null);
    assertEquals(await lookupPackage(s.db, "0".repeat(32)), null);
  } finally {
    await s.teardown();
  }
});

Deno.test("RISK 9: a suspended business is not-found for GET and claim", async () => {
  const { s, token } = await offerFixture();
  try {
    await s.db.from("tenants")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", s.tenantId);
    assertEquals(await lookupPackage(s.db, token), null);
    assertEquals(await claimPackage(s.db, token), null);
  } finally {
    await s.teardown();
  }
});

Deno.test("claim: stamps once on a pending offer, then idempotent", async () => {
  const { s, token } = await offerFixture();
  try {
    const first = await claimPackage(s.db, token);
    assertNotEquals(first, null);
    const second = await claimPackage(s.db, token);
    assertEquals(second!.paid_claimed_at, first!.paid_claimed_at);
    const p = await lookupPackage(s.db, token);
    assertEquals(p!.paid_claimed_at, first!.paid_claimed_at);
  } finally {
    await s.teardown();
  }
});

Deno.test("RISK 5: claim on a cancelled offer is null — a stale link cannot re-arm", async () => {
  const { s, id, token } = await offerFixture();
  try {
    await s.db.from("parent_packages").update({ status: "cancelled" }).eq("id", id);
    assertEquals(await claimPackage(s.db, token), null);
  } finally {
    await s.teardown();
  }
});

Deno.test("RISK 5: claim on an already-active package is null", async () => {
  const { s, id, token } = await offerFixture();
  try {
    await s.db.from("parent_packages").update({ status: "active" }).eq("id", id);
    assertEquals(await claimPackage(s.db, token), null);
  } finally {
    await s.teardown();
  }
});
