// The refusal card — the `allowed === false` branch only. Stage 4 of
// docs/refactor/PLATFORM_REFACTOR_PLAN.md, markup verbatim.
//
// ⚠ Its text is a DRIVER CONTRACT: verify-platform-admin asserts
// "for the SwimSync platform admin" and verify-platform-admin-scope matches
// /platform admin/i on it. Both are how the inverse guard (a tenant admin
// reaching /platform directly) is proven to still refuse.
//
// ⚠ The PageHeader title is the SAME as the real page's, so verify-smoke-admin's
// `h1 === "Platform"` passes on THIS branch too. The smoke driver is not evidence
// that the gate works.

import { PageHeader } from "@/components/PageHeader";

export function NotPlatformAdmin() {
  return (
    <div>
      <PageHeader title="Platform" subtitle="Cross-tenant operations" />
      <div className="rounded-2xl border border-gray-200 bg-white p-6 text-gray-600">
        This page is for the SwimSync platform admin. Your account
        administers a single business, which is what every other page shows.
      </div>
    </div>
  );
}
