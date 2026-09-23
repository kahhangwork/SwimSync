// Every read and write the parent Contact Details screen makes
// (docs/refactor/BATCH_FGH_PLAN.md, app fence). Raw builders, byte-identical to the
// chains they replaced in app/(parent)/profile/contact.tsx. ⚠ Two tables on purpose:
// name + phone on `profiles` (the account), address on `parents`.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

export const fetchParentAddress = (profileId: string | undefined) =>
  supabase
    .from("parents")
    .select("address, postal_code")
    .eq("profile_id", profileId)
    .single();

export const fetchProfileContact = (profileId: string | undefined) =>
  supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", profileId)
    .single();

export const updateParentAddress = (
  profileId: string | undefined,
  fields: { address: string | null; postal_code: string | null }
) =>
  supabase
    .from("parents")
    .update(fields)
    .eq("profile_id", profileId);

export const updateProfileContact = (
  profileId: string | undefined,
  fields: { full_name: string; phone: string | null }
) =>
  supabase
    .from("profiles")
    .update(fields)
    .eq("id", profileId);
