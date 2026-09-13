"use client";

import { PageHeader } from "@/components/PageHeader";
import { useUnassigned } from "./domain/useUnassigned";
import { UnassignedToolbar } from "./ui/UnassignedToolbar";
import { UnassignedTable } from "./ui/UnassignedTable";
import { AssignModal } from "./ui/AssignModal";

export default function UnassignedPage() {
  const p = useUnassigned();

  return (
    <div>
      <PageHeader
        title="Unassigned Children"
        subtitle={`${p.students.length} children awaiting class assignment`}
      />

      <UnassignedToolbar search={p.search} setSearch={p.setSearch} />

      <UnassignedTable
        filtered={p.filtered}
        loading={p.loading}
        covMap={p.covMap}
        openAssign={p.openAssign}
      />

      <AssignModal
        assignModal={p.assignModal}
        onClose={p.closeAssign}
        coaches={p.coaches}
        classOptions={p.classOptions}
        selectedCoachId={p.selectedCoachId}
        selectCoach={p.selectCoach}
        selectedClassId={p.selectedClassId}
        setSelectedClassId={p.setSelectedClassId}
        assigning={p.assigning}
        assignError={p.assignError}
        handleAssign={p.handleAssign}
      />
    </div>
  );
}
