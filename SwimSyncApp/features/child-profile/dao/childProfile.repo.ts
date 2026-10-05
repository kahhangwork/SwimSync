// Every PostgREST read the Child Profile screen makes (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F). Each returns the RAW builder — no mapping, no error handling, no
// await — byte-identical to the chain it replaced in app/(parent)/home/child/[id].tsx.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

export const fetchStudentProfile = (id: string) =>
  supabase
    .from("students")
    .select(`
        id,
        full_name,
        date_of_birth,
        gender,
        tenant_id,
        tenant_levels(label, note, tenant_level_skills(id, label, sort_order)),
        notes,
        assignment_status,
        is_active,
        student_class_enrolments(
          is_active,
          classes(
            day_of_week,
            start_time,
            end_time,
            locations(name, address, notes),
            coaches(
              profiles(full_name)
            )
          )
        )
      `)
    .eq("id", id)
    .single();

// Fetch outstanding invoices for the parent linked to this student
export const fetchParentLink = (id: string) =>
  supabase
    .from("parent_students")
    .select("parent_id")
    .eq("student_id", id)
    .single();

// Both money reads are scoped to ONE business — the child's. A family with
// children at two businesses must not see business B's bill on a business-A
// child's card (WAVE3_RENDER_TESTS_PLAN.md D5). Home's total stays family-wide.
export const fetchOutstandingInvoices = (parentId: string, tenantId: string) =>
  supabase
    .from("invoices")
    .select("net_amount")
    .eq("parent_id", parentId)
    .eq("status", "outstanding")
    .eq("tenant_id", tenantId);

// The embed filter narrows the EMBEDDED balances, never the parents row, so
// `.single()` still holds when the parent has no balance row at this business
// (creditOf then reads 0).
export const fetchParentBalances = (parentId: string, tenantId: string) =>
  supabase
    .from("parents")
    .select("parent_tenant_balances(credit_balance)")
    .eq("id", parentId)
    .eq("parent_tenant_balances.tenant_id", tenantId)
    .single();

export const fetchGradeScale = (tenantId: string) =>
  supabase
    .from("skill_grade_levels")
    .select("id, rank, label")
    .eq("tenant_id", tenantId)
    .order("rank");

export const fetchSkillProgress = (id: string) =>
  supabase
    .from("student_skill_progress")
    .select("skill_id, grade_level_id")
    .eq("student_id", id);
