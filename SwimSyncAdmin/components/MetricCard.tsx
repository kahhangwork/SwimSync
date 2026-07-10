import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  value: number | string;
  icon: LucideIcon;
  color?: "blue" | "red" | "green" | "yellow" | "purple";
  subtitle?: string;
}

const colorMap = {
  blue:   { bg: "bg-blue-50",   icon: "text-blue-600",   border: "border-blue-100"   },
  red:    { bg: "bg-red-50",    icon: "text-red-600",    border: "border-red-100"    },
  green:  { bg: "bg-green-50",  icon: "text-green-600",  border: "border-green-100"  },
  yellow: { bg: "bg-yellow-50", icon: "text-yellow-600", border: "border-yellow-100" },
  purple: { bg: "bg-purple-50", icon: "text-purple-600", border: "border-purple-100" },
};

export function MetricCard({ title, value, icon: Icon, color = "blue", subtitle }: Props) {
  const c = colorMap[color];
  return (
    <div className={cn("rounded-xl border p-5 bg-white shadow-sm", c.border)}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-gray-500">{title}</p>
        <div className={cn("rounded-lg p-2", c.bg)}>
          <Icon className={cn("h-5 w-5", c.icon)} />
        </div>
      </div>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
    </div>
  );
}
