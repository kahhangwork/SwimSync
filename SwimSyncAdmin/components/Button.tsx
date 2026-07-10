import { cn } from "@/lib/utils";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md";
}

const variants = {
  primary: "bg-sky-500 text-white hover:bg-sky-600 border-transparent",
  outline: "bg-white text-sky-600 border-sky-500 hover:bg-sky-50",
  ghost:   "bg-transparent text-gray-600 border-transparent hover:bg-gray-100",
  danger:  "bg-red-500 text-white hover:bg-red-600 border-transparent",
};

const sizes = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

export function Button({ variant = "primary", size = "md", className, children, ...rest }: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border font-medium transition-colors disabled:opacity-50",
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
