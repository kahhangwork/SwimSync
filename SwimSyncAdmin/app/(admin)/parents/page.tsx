"use client";

// Families at this business.
//
// There was no admin Parents page at all before this — ten admin pages and none
// of them listed the people who actually pay. That is why marking a family
// inactive needed a screen rather than a button.
//
// "Inactive" here means inactive AT THIS BUSINESS, not globally: parents are
// deliberately global (a family may have one child at a school and another with
// a private coach), so activity lives on parent_tenants. Nothing here can lock
// anyone out of the app — that is a platform power and this page does not have
// it.

import { PageHeader } from "@/components/PageHeader";
import { useParents } from "./domain/useParents";
import { ParentsToolbar } from "./ui/ParentsToolbar";
import { ParentsTable } from "./ui/ParentsTable";
import { FamilyStatusModal } from "./ui/FamilyStatusModal";

export default function ParentsPage() {
  const p = useParents();

  return (
    <div>
      <PageHeader
        title="Parents"
        subtitle={`${p.families.length} families at this business`}
      />

      <ParentsToolbar
        search={p.search}
        setSearch={p.setSearch}
        showInactive={p.showInactive}
        setShowInactive={p.setShowInactive}
      />

      <ParentsTable
        filtered={p.filtered}
        loading={p.loading}
        pkgByParent={p.pkgByParent}
        openModal={p.openModal}
      />

      <FamilyStatusModal
        pending={p.pending}
        onClose={() => p.setPending(null)}
        takeChildren={p.takeChildren}
        setTakeChildren={p.setTakeChildren}
        busy={p.busy}
        actionError={p.actionError}
        apply={p.apply}
      />
    </div>
  );
}
