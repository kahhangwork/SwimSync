import { Plus } from "lucide-react";
import { Button } from "@/components/Button";

// The PageHeader action, in ui/ so the page composition imports no lucide icon
// (keeps the tier fence's check-4 ledger empty — coaches/NewCoachButton pattern).
export function NewClassButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button onClick={onOpen}>
      <Plus className="h-4 w-4" />
      New Class
    </Button>
  );
}
