import { cn } from "@/lib/utils";

/**
 * The SwimSync mark — a poolside pace clock.
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
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={7.5}
        strokeLinecap="round"
      >
        <path d="M36.57 10.48A22 22 0 1 1 27.43 10.48" />
        <path d="M32 32 40.5 17.3" />
      </g>
      <circle cx="32" cy="32" r="4.5" fill="currentColor" />
    </svg>
  );
}

/**
 * The mark in its sky tile, at the sizes the panel actually uses.
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
  const inner = size === "lg" ? "h-8 w-8" : "h-5 w-5";

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center bg-sky-500",
        box,
        className
      )}
    >
      <LogoMark className={cn(inner, "text-white")} />
    </div>
  );
}
