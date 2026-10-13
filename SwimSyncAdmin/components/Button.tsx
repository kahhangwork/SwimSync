// The legacy admin button, kept for its API (variant/size names) while every call
// site keeps working; since UI restyle step 5.0 each variant draws DESIGN.md's look
// (primary = Lane Blue, outline = secondary, danger = destructive: Danger text on a
// secondary button — red FILL means nothing in DESIGN.md). Phase 7 folds callers onto
// components/ui/Button and deletes this. Unlike ui/Button it does NOT default
// type="button" — a form's submit relies on that, so the API stays as it was.
import { cn } from "@/lib/utils";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md";
}

const variants = {
  primary: "bg-primary text-white border-transparent hover:bg-primary-hover disabled:bg-status-neutral-bg disabled:text-ink-muted",
  outline: "bg-surface text-ink border-border-strong hover:bg-ground disabled:bg-status-neutral-bg disabled:text-ink-muted disabled:border-transparent",
  ghost:   "bg-transparent text-ink-secondary border-transparent hover:bg-selected hover:text-ink disabled:text-ink-muted",
  danger:  "bg-surface text-status-danger-text border-border-strong hover:bg-status-danger-bg disabled:bg-status-neutral-bg disabled:text-ink-muted disabled:border-transparent",
};

const sizes = {
  sm: "h-[1.875rem] px-3 text-label",
  md: "h-9 px-4 text-body",
};

export function Button({ variant = "primary", size = "md", className, children, ...rest }: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-control border font-semibold transition-colors disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        variants[variant],
        sizes[size],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
