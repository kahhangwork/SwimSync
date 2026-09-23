// Every PostgREST read the parent Invoice Detail screen makes
// (docs/refactor/BATCH_FGH_PLAN.md, App L-G). Raw builders, byte-identical to the
// chains they replaced in app/(parent)/billing/invoice/[id].tsx.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

export const fetchInvoiceDetail = (id: string) =>
  supabase
    .from("invoices")
    .select(`
      id,
      reference_number,
      billing_month,
      gross_amount,
      package_applied,
      credit_applied,
      balance_adjustment,
      net_amount,
      status,
      generated_at,
      paid_at,
      paid_claimed_at,
      tenants(display_name),
      invoice_items(
        id,
        lesson_session_id,
        amount,
        class_title,
        session_date,
        attendance_status,
        student_name,
        students(full_name)
      )
    `)
    .eq("id", id)
    .single();

// Fetch credit notes applied to this invoice
export const fetchAppliedCreditNotes = (id: string) =>
  supabase
    .from("credit_notes")
    .select("id, reference_number, amount, reason")
    .eq("applied_to_invoice_id", id);

// Which lines the package funded. RLS scopes the ledger to the parent's own
// packages.
export const fetchPackageApplications = (itemIds: string[]) =>
  supabase
    .from("package_applications")
    .select("invoice_item_id, reversed_at, parent_packages(name)")
    .in("invoice_item_id", itemIds);

// NB: by lesson_session_id (not the invoice_item id).
export const fetchSessionCoach = (lessonSessionId: string) =>
  supabase
    .from("lesson_sessions")
    .select("classes(coach_id)")
    .eq("id", lessonSessionId)
    .single();
