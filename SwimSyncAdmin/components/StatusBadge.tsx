import { cn } from "@/lib/utils";

const config: Record<string, string> = {
  Outstanding:  "bg-red-100 text-red-700",
  Paid:         "bg-green-100 text-green-700",
  Applied:      "bg-blue-100 text-blue-700",
  Pending:      "bg-yellow-100 text-yellow-700",
  Present:      "bg-green-100 text-green-700",
  Absent:       "bg-gray-100 text-gray-500",
  Cancelled:    "bg-orange-100 text-orange-600",
  Trial:        "bg-blue-100 text-blue-600",
  Assigned:     "bg-green-100 text-green-700",
  Unassigned:   "bg-yellow-100 text-yellow-700",
  Inactive:     "bg-gray-100 text-gray-400",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        config[status] ?? "bg-gray-100 text-gray-500"
      )}
    >
      {status}
    </span>
  );
}
