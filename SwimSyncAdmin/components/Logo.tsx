import { cn } from "@/lib/utils";

/**
 * The SwimSync mark — a wave flowing into a tick (DESIGN.md → Logo, concept 2a).
 *
 * Canonical geometry lives in `brand/mark.svg` at the repo root; this component
 * is a hand-kept copy of the same paths so the admin can render it inline (no
 * network request, recolourable via `currentColor`). If the mark is ever
 * redrawn, update both — and the generated PNGs in `SwimSyncApp/assets/` and
 * `SwimSyncAdmin/public/`, which are rasterised from the SVGs in `brand/`.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("h-full w-full", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M6 32Q13 21 20 32T34 32L42 42 58 18"
        fill="none"
        stroke="currentColor"
        // 9, not the canonical 8.5: every use here is 24–40px, around the 32px
        // where DESIGN.md thickens the stroke so the wave does not thin out.
        strokeWidth={9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The mark in its Lane Blue tile, at the sizes the panel actually uses.
 * `sm` is the sidebar brand; `lg` is the centred mark on the auth screens.
 */
export function Logo({
  size = "sm",
  className,
}: {
  size?: "sm" | "lg";
  className?: string;
}) {
  const box = size === "lg" ? "h-14 w-14 rounded-2xl" : "h-9 w-9 rounded-xl";
  // ~70% of the tile, as in the app icon: the mark is wide and flat, so the
  // pace clock's ~57% left it looking lost in the tile.
  const inner = size === "lg" ? "h-10 w-10" : "h-6 w-6";

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center bg-blue-600",
        box,
        className
      )}
    >
      <LogoMark className={cn(inner, "text-white")} />
    </div>
  );
}
