// The parent Contact Details screen's state, its load and its save
// (docs/refactor/BATCH_FGH_PLAN.md, app fence). Moved VERBATIM from
// app/(parent)/profile/contact.tsx; builders are dao calls. The focus effect keeps
// its deps ([session?.id]) and its wait-for-the-id guard (the smoke-app finding).
import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { useAppStore } from "@/store/useAppStore";
import {
  fetchParentAddress,
  fetchProfileContact,
  updateParentAddress,
  updateProfileContact,
} from "../dao/contact.repo";

export function useContactDetails() {
  // ⚠ NAME AND PHONE LIVE ON `profiles`, ADDRESS ON `parents` — two tables, one
  // screen, deliberately. profiles is shared with coaches and admins (it is
  // the account), while a home address is a parent-shaped fact.
  //
  // WHY THEY ARE EDITABLE HERE AT ALL. An INVITED parent never fills in the
  // registration form — /accept-invite only ever asked for a password — so
  // their name and phone were blank with NO screen anywhere in the app able to
  // set them. The admin's Students page then showed a blank parent, which
  // reads as "this child has no parent" when it has one. Reported from
  // production 2026-07-26.
  // It also disabled a feature: the parent's phone is one of the two signals
  // that matches a family to a child their coach already added, so an invited
  // parent could never match on it.
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [postal, setPostal] = useState("");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  const session = useAppStore((s) => s.session);
  const showToast = useAppStore((s) => s.showToast);

  useFocusEffect(
    useCallback(() => {
      // On a hard reload of this screen the session is still restoring, so
      // the id is undefined: querying with it fired two `eq.undefined` 400s
      // (found by verify-smoke-app.mjs, 2026-09-13). The effect re-runs when
      // the id arrives, so waiting is the whole fix.
      if (!session?.id) return;
      let cancelled = false;
      (async () => {
        const [{ data }, { data: prof }] = await Promise.all([
          fetchParentAddress(session?.id),
          fetchProfileContact(session?.id),
        ]);
        if (cancelled) return;
        setAddress(data?.address ?? "");
        setPostal(data?.postal_code ?? "");
        setFullName(prof?.full_name ?? "");
        setPhone(prof?.phone ?? "");
        setReady(true);
      })();
      return () => {
        cancelled = true;
      };
    }, [session?.id])
  );

  async function handleSave() {
    // Check the format only when something was typed — clearing both fields is
    // a legitimate edit, and a blank must become NULL rather than "".
    if (postal.trim() && !/^[0-9]{6}$/.test(postal.trim())) {
      showToast("Postal code should be 6 digits.", "error");
      return;
    }
    // Required, unlike everything else here: a blank name is what made an
    // invited family look like no family at all on the coach's roster.
    if (!fullName.trim()) {
      showToast("Please enter your name.", "error");
      return;
    }

    setSaving(true);
    const [{ error }, { error: profErr }] = await Promise.all([
      updateParentAddress(session?.id, {
        address: address.trim() || null,
        postal_code: postal.trim() || null,
      }),
      updateProfileContact(session?.id, {
        full_name: fullName.trim(),
        phone: phone.trim() || null,
      }),
    ]);
    setSaving(false);

    if (error || profErr) {
      showToast("Could not save your details. Please try again.", "error");
      return;
    }
    showToast("Your details have been saved.", "success");
    router.back();
  }

  return {
    fullName,
    setFullName,
    phone,
    setPhone,
    address,
    setAddress,
    postal,
    setPostal,
    ready,
    saving,
    handleSave,
  };
}
