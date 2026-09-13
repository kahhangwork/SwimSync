// Admins page — the PageHeader action (owner-only; the page decides visibility).

import { Plus } from "lucide-react";
import { Button } from "@/components/Button";

export function InviteAdminButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button onClick={onOpen}>
      <Plus className="h-4 w-4" />
      Invite admin
    </Button>
  );
}
