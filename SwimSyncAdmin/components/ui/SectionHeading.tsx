// DESIGN.md's card / section title on the admin (UI restyle step 1.3): Headline,
// 600 16px Ink, with an optional Body Secondary line under it and an action on
// the right. The page title is PageHeader's job, not this.
//
// The app's SectionHeading is the small muted group label ("Coming up") — a
// phone screen groups cards; an admin page titles its sections.
import { cn } from "@/lib/utils";

interface Props {
  children: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function SectionHeading({ children, description, action, className }: Props) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div>
        <h2 className="text-headline font-semibold text-ink">{children}</h2>
        {description && <p className="text-body-secondary text-ink-secondary mt-0.5">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
