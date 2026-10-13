import type { TenantInfo } from "../types";

type Props = {
  tenant: TenantInfo;
  editingName: boolean;
  setEditingName: (v: boolean) => void;
  nameDraft: string;
  setNameDraft: (v: string) => void;
  savingName: boolean;
  handleSaveName: () => void;
  regenerating: boolean;
  handleRegenerate: () => void;
  /** Business profile: Edit (roles). Without it the card is read-only — the
   *  tenants column guard and regenerate_join_code refuse server-side anyway. */
  canEdit?: boolean;
};

/* The join code is how families reach this business. There is no public
   directory of coaches, so without the code a parent cannot add a child
   here at all — which makes this the most operationally important thing
   on the page for a new school. */
export function TenantCard({
  tenant,
  editingName,
  setEditingName,
  nameDraft,
  setNameDraft,
  savingName,
  handleSaveName,
  regenerating,
  handleRegenerate,
  canEdit = true,
}: Props) {
  return (
    <div className="mb-6 rounded-card border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2">
            {editingName ? (
              <>
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="h-9 rounded-control border border-border-strong bg-surface px-2 text-body text-ink focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary"
                  placeholder="Business name"
                />
                <button
                  onClick={handleSaveName}
                  disabled={savingName}
                  className="text-body font-medium text-primary underline underline-offset-2 disabled:text-ink-muted"
                >
                  {savingName ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => setEditingName(false)}
                  className="text-body text-primary"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="text-headline font-semibold text-ink">
                  {tenant.display_name}
                </span>
                {canEdit && (
                <button
                  onClick={() => {
                    setNameDraft(tenant.display_name);
                    setEditingName(true);
                  }}
                  className="text-label font-medium text-primary underline underline-offset-2"
                >
                  Rename
                </button>
                )}
              </>
            )}
          </div>
          <p className="text-label font-medium text-ink-muted">
            Parent join code
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-widest text-ink">
            {tenant.join_code}
          </p>
          <p className="mt-1 text-body text-ink-secondary">
            Share this with parents so they can add their children to your
            classes.
          </p>
        </div>
        {canEdit && (
        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          className="h-9 rounded-control border border-border-strong bg-surface px-4 text-body font-semibold text-ink hover:bg-ground disabled:bg-status-neutral-bg disabled:text-ink-muted"
        >
          {regenerating ? "Generating…" : "Generate a new code"}
        </button>
        )}
      </div>
      <p className="mt-3 text-label font-normal text-ink-muted">
        Generating a new code does not remove families who have already
        joined — it only stops the old code working for new ones.
      </p>
    </div>
  );
}
