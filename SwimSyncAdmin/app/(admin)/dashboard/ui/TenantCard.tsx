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
}: Props) {
  return (
    <div className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2">
            {editingName ? (
              <>
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="rounded-lg border border-sky-300 px-2 py-1 text-sm"
                  placeholder="Business name"
                />
                <button
                  onClick={handleSaveName}
                  disabled={savingName}
                  className="text-sm font-medium text-sky-800 underline disabled:opacity-50"
                >
                  {savingName ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => setEditingName(false)}
                  className="text-sm text-sky-700"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="text-sm font-semibold text-sky-900">
                  {tenant.display_name}
                </span>
                <button
                  onClick={() => {
                    setNameDraft(tenant.display_name);
                    setEditingName(true);
                  }}
                  className="text-xs font-medium text-sky-700 underline"
                >
                  Rename
                </button>
              </>
            )}
          </div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
            Parent join code
          </p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-widest text-sky-900">
            {tenant.join_code}
          </p>
          <p className="mt-1 text-sm text-sky-800">
            Share this with parents so they can add their children to your
            classes.
          </p>
        </div>
        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          className="rounded-xl border border-sky-300 bg-white px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50"
        >
          {regenerating ? "Generating…" : "Generate a new code"}
        </button>
      </div>
      <p className="mt-3 text-xs text-sky-700">
        Generating a new code does not remove families who have already
        joined — it only stops the old code working for new ones.
      </p>
    </div>
  );
}
