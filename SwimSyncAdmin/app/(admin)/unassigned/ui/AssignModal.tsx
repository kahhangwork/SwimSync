// Unassigned page — assign-to-class modal (coach then class, guarded confirm).

import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { ClassOption, Coach, Student } from "../types";
import { capitalize, formatTime } from "../domain/unassignedRows";

type Props = {
  assignModal: Student | null;
  onClose: () => void;
  coaches: Coach[];
  classOptions: ClassOption[];
  selectedCoachId: string;
  selectCoach: (coachId: string) => void;
  selectedClassId: string;
  setSelectedClassId: (v: string) => void;
  assigning: boolean;
  assignError: string | null;
  handleAssign: () => void;
};

export function AssignModal(p: Props) {
  const { assignModal } = p;
  return (
    <Modal
      title={`Assign ${assignModal?.full_name ?? ""} to a Class`}
      open={!!assignModal}
      onClose={p.onClose}
    >
      <div className="space-y-4">
        {assignModal && (
          <div className="rounded-xl bg-gray-50 p-3 text-sm">
            <p className="font-medium text-gray-900">{assignModal.full_name}</p>
            <p className="text-gray-500">Parent: {assignModal.parent_name}</p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Select Coach
          </label>
          <select
            value={p.selectedCoachId}
            onChange={(e) => p.selectCoach(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
          >
            <option value="">— Choose a coach —</option>
            {p.coaches.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Select Class
          </label>
          <select
            value={p.selectedClassId}
            onChange={(e) => p.setSelectedClassId(e.target.value)}
            disabled={!p.selectedCoachId}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-50"
          >
            <option value="">— Choose a class —</option>
            {p.classOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} · {capitalize(c.day_of_week)}{" "}
                {formatTime(c.start_time)} · {c.student_count} students
              </option>
            ))}
          </select>
        </div>

        {p.assignError && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {p.assignError}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1" onClick={p.onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={!p.selectedCoachId || !p.selectedClassId || p.assigning}
            onClick={p.handleAssign}
          >
            {p.assigning ? "Assigning…" : "Confirm Assignment"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
