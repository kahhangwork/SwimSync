// Coaches page — a labelled text input used in the create-coach modal.
// (Feature-scoped by design — see the playbook on not lifting to @/components
// prematurely; a later consolidation is a separate, deliberate move.)

export function Field({
  label,
  placeholder,
  type = "text",
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-body font-medium text-ink-secondary mb-1.5">
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-card border border-border-strong bg-ground px-4 py-2.5 text-body placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  );
}
