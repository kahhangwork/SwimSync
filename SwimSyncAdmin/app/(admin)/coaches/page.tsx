"use client";

import { PageHeader } from "@/components/PageHeader";
import { useCoaches } from "./domain/useCoaches";
import { NewCoachButton } from "./ui/NewCoachButton";
import { CoachesTable } from "./ui/CoachesTable";
import { CreateCoachModal } from "./ui/CreateCoachModal";
import { DisableCoachModal } from "./ui/DisableCoachModal";
import { ReactivateCoachModal } from "./ui/ReactivateCoachModal";

export default function CoachesPage() {
  const p = useCoaches();

  return (
    <div>
      <PageHeader
        title="Coaches"
        subtitle={`${p.coaches.length} coaches`}
        action={<NewCoachButton onOpen={p.openCreate} />}
      />

      <CoachesTable
        coaches={p.coaches}
        loading={p.loading}
        openDisable={p.openDisable}
        openReactivate={p.openReactivate}
      />

      <CreateCoachModal
        open={p.showCreate}
        onClose={() => p.setShowCreate(false)}
        name={p.name}
        setName={p.setName}
        email={p.email}
        setEmail={p.setEmail}
        phone={p.phone}
        setPhone={p.setPhone}
        password={p.password}
        setPassword={p.setPassword}
        creating={p.creating}
        createError={p.createError}
        handleCreate={p.handleCreate}
      />

      <DisableCoachModal
        disableModal={p.disableModal}
        onClose={() => p.setDisableModal(null)}
        replacementId={p.replacementId}
        setReplacementId={p.setReplacementId}
        replacementOptions={p.replacementOptions}
        impact={p.impact}
        impactError={p.impactError}
        actionError={p.actionError}
        actionBusy={p.actionBusy}
        handleDisable={p.handleDisable}
      />

      <ReactivateCoachModal
        reactivateModal={p.reactivateModal}
        onClose={() => p.setReactivateModal(null)}
        actionError={p.actionError}
        actionBusy={p.actionBusy}
        handleReactivate={p.handleReactivate}
      />
    </div>
  );
}
