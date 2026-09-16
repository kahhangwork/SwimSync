import type { RefObject } from "react";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/Button";

type Props = {
  fileInput: RefObject<HTMLInputElement | null>;
  busy: boolean;
  onCsvChosen: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAdd: () => void;
};

// The PageHeader action cluster: Import CSV (hidden file input) + Add holiday.
export function HolidaysActions({ fileInput, busy, onCsvChosen, onAdd }: Props) {
  return (
    <div className="flex gap-2">
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={onCsvChosen}
      />
      <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={busy}>
        <Upload className="h-4 w-4" />
        Import CSV
      </Button>
      <Button onClick={onAdd}>
        <Plus className="h-4 w-4" />
        Add holiday
      </Button>
    </div>
  );
}
