// The page-level error banner (list-core, slice 1). Stage 4 of
// PACKAGES_REFACTOR_PLAN.md. Renders nothing when there is no error.

export function ListNotices({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    // role="alert" is how a driver finds it — never its colour classes, which a
    // restyle changes (UI restyle 5.3; §7.375). A <p>, because Next's own route
    // announcer is a role=alert DIV.
    <p
      role="alert"
      className="mb-4 rounded-card border border-status-danger-border bg-status-danger-bg px-4 py-3 text-body text-status-danger-text"
    >
      {error}
    </p>
  );
}
