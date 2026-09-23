// Every PostgREST read the parent PayNow screen makes (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G). Raw builders, byte-identical to the chains they replaced in
// app/(parent)/billing/paynow.tsx.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

export const fetchPackageForPay = (packageId: string) =>
  supabase
    .from("parent_packages")
    // Kept on ONE line on purpose: `"a" + "b"` widens to `string`, and
    // the typed client can only parse a select it sees as a literal.
    .select("name, amount_payable, reference_number, tenants(display_name, paynow_qr_url, paynow_uen, paynow_mobile)")
    .eq("id", packageId)
    .single();

export const fetchInvoiceForPay = (invoiceId: string) =>
  supabase
    .from("invoices")
    .select("net_amount, billing_month, reference_number, tenants(display_name, paynow_qr_url, paynow_uen, paynow_mobile)")
    .eq("id", invoiceId)
    .single();
