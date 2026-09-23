import React from "react";
import { ScrollView, SafeAreaView } from "react-native";
import { useEditChild } from "@/features/edit-child/domain/useEditChild";
import { LoadingView } from "@/features/edit-child/ui/LoadingView";
import { LoadErrorView } from "@/features/edit-child/ui/LoadErrorView";
import { Header } from "@/features/edit-child/ui/Header";
import { EditForm } from "@/features/edit-child/ui/EditForm";

// Editing a child, deliberately a SIBLING ROUTE of add-child rather than a
// nested child/[id]/edit — child/[id].tsx is a file, so nesting would mean
// restructuring the route into a folder for no gain.
//
// What is NOT editable here, and why:
//   • the business (students.tenant_id) — a student moves between businesses
//     only via the platform admin's RPC. The database pins it (migration
//     20260719001500) after a parent was found able to inject their own child
//     onto a rival's roster.
//   • assignment / activity — those belong to the business's admin (PRD §7.14).
//
// Renaming a child is safe for billing: invoices and credit notes snapshot the
// name they were issued with (migration 20260719001600), so history does not
// move when a name is corrected.
//
// Composition only (docs/refactor/BATCH_FGH_PLAN.md, App L-F): the load (a focus
// effect) and the save live in features/edit-child/domain/useEditChild, markup in
// …/ui. The two early returns keep their order: not-ready first, then load error.
export default function EditChildScreen() {
  const {
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
  } = useEditChild();

  if (!ready) {
    return <LoadingView />;
  }

  if (loadError) {
    return <LoadErrorView />;
  }

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <Header />

      <ScrollView
        contentContainerClassName="px-5 pb-10"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <EditForm name={name} setName={setName} dob={dob} setDob={setDob} gender={gender} setGender={setGender} notes={notes} setNotes={setNotes} loading={loading} handleSave={handleSave} />
      </ScrollView>
    </SafeAreaView>
  );
}
