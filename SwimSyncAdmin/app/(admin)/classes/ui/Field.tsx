// The classes-form input atom. Feature-scoped on purpose (playbook §5 / §7.233):
// a byte-identical dup across feature folders is allowed; a THIRD copy is the
// trigger to lift it to @/components, filed in BACKLOG, not pre-empted here.
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
