// The Edit Child screen's state, its load and its save (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F). Moved VERBATIM from app/(parent)/home/edit-child.tsx — the route's
// header comment (why this is a sibling route, what is NOT editable, why a rename
// is safe for billing) stays on the route.
//
// ⚠ THE FOCUS EFFECT'S DEPS ARE BYTE-IDENTICAL ([id]) — loading once per focus
// is deliberate (the comment inside says why), and plan ⚠ R4.
import { useCallback, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useAppStore } from "@/store/useAppStore";
import { fetchChildForEdit, updateChild } from "../dao/editChild.repo";

export function useEditChild() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("Male");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [ready, setReady] = useState(false);

  const showToast = useAppStore((s) => s.showToast);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const { data } = await fetchChildForEdit(id);
        if (cancelled) return;
        if (!data) {
          setLoadError(true);
          setReady(true);
          return;
        }
        setName(data.full_name ?? "");
        setDob(data.date_of_birth ?? "");
        setGender(
          data.gender ? data.gender.charAt(0).toUpperCase() + data.gender.slice(1) : "Male"
        );
        setNotes(data.notes ?? "");
        setReady(true);
      })();
      return () => {
        cancelled = true;
      };
      // Loading once per focus is deliberate: re-running on every keystroke
      // would stomp the fields the parent is editing.
    }, [id])
  );

  async function handleSave() {
    if (!name.trim()) {
      showToast("Full name is required.", "error");
      return;
    }
    if (!dob.trim()) {
      showToast("Date of birth is required.", "error");
      return;
    }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dob.trim())) {
      showToast("Date of birth must be in YYYY-MM-DD format.", "error");
      return;
    }

    setLoading(true);
    const { error } = await updateChild(id, {
      full_name: name.trim(),
      date_of_birth: dob.trim(),
      gender: gender.toLowerCase(),
      notes: notes.trim() || null,
    });
    setLoading(false);

    if (error) {
      // A child is identified by name + date of birth within a business
      // (students_identity_uniq). Editing into an existing pair almost always
      // means this child is already on file twice.
      if (error.code === "23505") {
        showToast(
          `Another child called ${name.trim()} with that date of birth is already registered here.`,
          "error"
        );
        return;
      }
      // 23514 is the tenant/created_by pin. Unreachable from this form, which
      // sends neither — but if it ever fires, say something true rather than
      // "please try again", which would invite exactly the retry that cannot work.
      if (error.code === "23514") {
        showToast(
          "That change isn't allowed here. Please contact your coach or school.",
          "error"
        );
        return;
      }
      showToast("Could not save changes. Please try again.", "error");
      return;
    }

    showToast(`${name.trim()}'s profile has been updated.`, "success");
    router.back();
  }

  return {
    name,
    setName,
    dob,
    setDob,
    gender,
    setGender,
    notes,
    setNotes,
    loading,
    loadError,
    ready,
    handleSave,
  };
}
