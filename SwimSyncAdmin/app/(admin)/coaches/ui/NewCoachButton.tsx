// Coaches page — the PageHeader action.

import { Plus } from "lucide-react";
import { Button } from "@/components/Button";

export function NewCoachButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button onClick={onOpen}>
      <Plus className="h-4 w-4" />
      New Coach
    </Button>
  );
}
