import { cn } from "@/lib/utils";

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("w-full overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm", className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

/**
 * Emits its own <tr>, so callers pass <Th> DIRECTLY. Never wrap them in a <Tr>.
 *
 * It used not to, and the convention split: some call sites wrapped their <Th>s
 * in a row and some did not, so the bare ones produced invalid HTML — <th>
 * cannot be a child of <thead>. Moving the row in here fixed those.
 *
 * ⚠ THE SWEEP THAT CAME WITH IT MISSED levels/page.tsx, AND THIS COMMENT USED
 * TO CLAIM OTHERWISE. It named levels as one of the pages the change fixed;
 * levels in fact still had its <Tr> at that very commit, so the change is what
 * broke it: <tr> inside <tr>, all five headers collapsed into one cell in
 * column 1, and every column pushed out of line with its own header. It
 * shipped to production and stayed there for a week — no test covered it, and
 * every text-based assertion passes on a table whose labels are all correct
 * and merely in the wrong place.
 *
 * The old comment also asserted that owning the row made the broken form
 * "unrepresentable". It did not: a caller can still nest a <Tr> and nothing
 * stops them. Prose cannot enforce a call-site contract.
 * **components/Table.test.tsx scans every admin page and fails if one does.**
 * That test is the enforcement; this paragraph is only the reason.
 * See HANDOVER §7.54.
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
