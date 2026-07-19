import { cn } from "@/lib/utils";

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("w-full overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm", className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

/**
 * Emits its own <tr>, so callers pass <Th> directly.
 *
 * It used not to, and the convention split: nine call sites wrapped their <Th>s
 * in a <tr> and three did not. The three produced INVALID HTML — <th> cannot be
 * a child of <thead> — which React reports as a hydration error at runtime on
 * the wages, levels and platform pages. Owning the row here makes the broken
 * form unrepresentable rather than something each caller must remember.
 */
export function Thead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-gray-200 bg-gray-50">
      <tr>{children}</tr>
    </thead>
  );
}

export function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn("px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500", className)}>
      {children}
    </th>
  );
}

export function Tbody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-gray-100">{children}</tbody>;
}

export function Tr({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <tr className={cn("hover:bg-gray-50 transition-colors", className)}>
      {children}
    </tr>
  );
}

export function Td({
  children,
  className,
  colSpan,
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={cn("px-4 py-3 text-gray-700", className)}>
      {children}
    </td>
  );
}
