// DESIGN.md's card (UI restyle step 1.3): Surface, 1px Border, 8px corners, 16px
// padding, no shadow — flat by default.
import { cn } from "@/lib/utils";

export const SURFACE = "bg-surface border border-border rounded-card p-4";

export function Surface({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn(SURFACE, className)} {...rest}>
      {children}
    </div>
  );
}
