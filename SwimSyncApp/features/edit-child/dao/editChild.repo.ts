// Every PostgREST read and write the Edit Child screen makes
// (docs/refactor/BATCH_FGH_PLAN.md, App L-F). Raw builders, byte-identical to the
// chains they replaced in app/(parent)/home/edit-child.tsx.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

export const fetchChildForEdit = (id: string) =>
  supabase
    .from("students")
    .select("full_name, date_of_birth, gender, notes")
    .eq("id", id)
    .single();

export type ChildEdit = {
  full_name: string;
  date_of_birth: string;
  gender: string;
  notes: string | null;
};

export const updateChild = (id: string, changes: ChildEdit) =>
  supabase
    .from("students")
    .update(changes)
    .eq("id", id);
