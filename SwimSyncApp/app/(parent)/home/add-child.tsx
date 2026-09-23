import React from "react";
import { ScrollView, SafeAreaView } from "react-native";
import { useAddChild } from "@/features/add-child/domain/useAddChild";
import { Header } from "@/features/add-child/ui/Header";
import { JoinFirstPrompt } from "@/features/add-child/ui/JoinFirstPrompt";
import { TenantPicker } from "@/features/add-child/ui/TenantPicker";
import { ChildForm } from "@/features/add-child/ui/ChildForm";
import { ReviewOverlay } from "@/features/add-child/ui/ReviewOverlay";
import { CandidatesOverlay } from "@/features/add-child/ui/CandidatesOverlay";

// Add Child — composition only (docs/refactor/BATCH_FGH_PLAN.md, App L-F). State,
// the tenant load (a focus effect) and the one write path (`add_child_or_claim`)
// live in features/add-child/domain/useAddChild; markup in …/ui.
export default function AddChildScreen() {
  // Which business this child is being added to — see useAddChild.
  const {
    tenants,
    tenantId,
    setTenantId,
    name,
    setName,
    dob,
    setDob,
    gender,
    setGender,
    notes,
    setNotes,
    loading,
    candidates,
    setCandidates,
    chosen,
    setChosen,
    reviewing,
    setReviewing,
    handleSave,
    submit,
  } = useAddChild();

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <Header />

      <ScrollView
        contentContainerClassName="px-5 pb-10"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <JoinFirstPrompt tenants={tenants} />

        <TenantPicker tenants={tenants} tenantId={tenantId} setTenantId={setTenantId} />

        <ChildForm name={name} setName={setName} dob={dob} setDob={setDob} gender={gender} setGender={setGender} notes={notes} setNotes={setNotes} loading={loading} handleSave={handleSave} />
      </ScrollView>

      <ReviewOverlay reviewing={reviewing} candidates={candidates} name={name} dob={dob} gender={gender} notes={notes} loading={loading} submit={submit} setReviewing={setReviewing} />

      <CandidatesOverlay candidates={candidates} chosen={chosen} setChosen={setChosen} loading={loading} submit={submit} name={name} setCandidates={setCandidates} />
    </SafeAreaView>
  );
}
