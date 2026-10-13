// DESIGN.md: admin page titles are 26px (UI restyle 5.0); the line under is Body
// in Ink Secondary.
interface Props {
  title: React.ReactNode;
  subtitle?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, subtitle, action }: Props) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-[1.625rem] font-semibold leading-[1.2] tracking-[-0.02em] text-ink">{title}</h1>
        {subtitle && <p className="text-body text-ink-secondary mt-1">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
