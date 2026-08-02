// Integration + serializer tests for public-invoice. Runs against the LOCAL
// stack via generate-invoices' test.sh (which exports SUPABASE_URL +
// SERVICE_ROLE_KEY and includes this file).
//
// ⚠ RISK 3 pins live here:
//   • the EXACT response key set — a new key is a test failure, not a leak;
//   • null for every failure class (malformed / unknown / claim-on-paid) —
//     index.ts maps null to ONE shared 404, so uniformity is structural and
//     these nulls are the whole oracle surface;
//   • first-names-only, deduplicated.

import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { newScenario } from "../generate-invoices/test-helpers.ts";
import { claimInvoice, lookupInvoice, serializePublicInvoice } from "./core.ts";

// ── Serializer (pure) ───────────────────────────────────────────────────────

const ROW = {
  net_amount: 300,
  billing_month: "2026-07",
  status: "outstanding",
  paid_claimed_at: null,
  reference_number: "INV-2026-0001",
  tenants: { display_name: "Swim A", paynow_uen: null, paynow_mobile: "91234567" },
  invoice_items: [
    { student_name: "Alice Tan" },
    { student_name: "Alice Tan" },
    { student_name: "Ben Tan" },
  ],
};

Deno.test("serializer: the public key set is EXACT — a new key is a failure", () => {
  assertEquals(Object.keys(serializePublicInvoice(ROW)).sort(), [
    "amount",
    "billing_month",
    "business_name",
    "paid_claimed_at",
    "paynow_mobile",
    "paynow_uen",
    "reference",
    "status",
    "students",
  ]);
});

Deno.test("serializer: first names only, deduplicated — never a full child name", () => {
  assertEquals(serializePublicInvoice(ROW).students, ["Alice", "Ben"]);
});

Deno.test("serializer: survives the PostgREST array-embed shape and null items", () => {
  const arrShape = serializePublicInvoice({
    ...ROW,
    tenants: [ROW.tenants],
    invoice_items: null,
  });
  assertEquals(arrShape.business_name, "Swim A");
  assertEquals(arrShape.students, []);
});

// ── Against the local stack ─────────────────────────────────────────────────

async function invoiceFixture() {
  const s = await newScenario();
  const { data, error } = await s.db
    .from("invoices")
    .insert({
      parent_id: s.parentId,
      tenant_id: s.tenantId,
      billing_month: "2026-06",
      gross_amount: 120,
      net_amount: 120,
    })
    .select("public_token, reference_number")
    .single();
  if (error || !data) throw new Error(`fixture invoice: ${error?.message}`);
  return { s, token: data.public_token as string, ref: data.reference_number as string };
}

Deno.test("lookup: a real token returns the invoice; the trigger's ref rides along", async () => {
  const { s, token, ref } = await invoiceFixture();
  try {
    const inv = await lookupInvoice(s.db, token);
    assertNotEquals(inv, null);
    assertEquals(inv!.amount, 120);
    assertEquals(inv!.billing_month, "2026-06");
    assertEquals(inv!.reference, ref);
    assertEquals(inv!.status, "outstanding");
  } finally {
    await s.teardown();
  }
});

Deno.test("lookup: malformed and unknown tokens are both null — no oracle between them", async () => {
  const { s } = await invoiceFixture();
  try {
    assertEquals(await lookupInvoice(s.db, "not-a-token"), null);
    assertEquals(await lookupInvoice(s.db, ""), null);
    assertEquals(await lookupInvoice(s.db, "0".repeat(32)), null);
  } finally {
    await s.teardown();
  }
});

Deno.test("claim: stamps once, then stays idempotent at the first timestamp", async () => {
  const { s, token } = await invoiceFixture();
  try {
    const first = await claimInvoice(s.db, token);
    assertNotEquals(first, null);
    const second = await claimInvoice(s.db, token);
    assertEquals(second!.paid_claimed_at, first!.paid_claimed_at);

    const inv = await lookupInvoice(s.db, token);
    assertEquals(inv!.paid_claimed_at, first!.paid_claimed_at);
  } finally {
    await s.teardown();
  }
});

Deno.test("claim: a paid invoice is null — same not-found as an unknown token", async () => {
  const { s, token } = await invoiceFixture();
  try {
    await s.db
      .from("invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("public_token", token);
    assertEquals(await claimInvoice(s.db, token), null);
  } finally {
    await s.teardown();
  }
});
