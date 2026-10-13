// The bottom action area (UI restyle step 2.2): Set all and Save, where a thumb
// reaches them (DESIGN.md → Layout). A flex-column FOOTER of the screen, not an
// absolute overlay — it cannot sit on top of the roster, and the coach tab bar is
// below it, outside this screen (§7.58's overlap trap).
//
// Not rendered at all on a read-only lesson: no Save, no Set all — the absence plus
// RoleNotice says whose job it is (the route's rule, unchanged).
import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/components/ui/Button";

export default function AttendanceActions(p: {
  hasStudents: boolean;
  menuOpen: boolean;
  setMenuOpen: (f: (v: boolean) => boolean) => void;
  saving: boolean;
  onSave: () => void;
}) {
  const { hasStudents, menuOpen, setMenuOpen, saving, onSave } = p;
  return (
    <View
      testID="mark-attendance-actions"
      className="flex-row gap-3 px-5 py-3 bg-surface border-t border-border"
    >
      {/* Set all only when there is someone to set. Its menu opens UPWARD
          (SetAllMenu), so the chevron points up while it is closed. */}
      {hasStudents && (
        <Button
          variant="secondary"
          label="Set all"
          onPress={() => setMenuOpen((v) => !v)}
          icon={
            <Ionicons name={menuOpen ? "chevron-down" : "chevron-up"} size={16} color="#0a0a0a" />
          }
        />
      )}
      {/* ⚠ NOT `disabled` while saving: what enables Save is useSaveAttendance's
          business (plan 2.2 — the restyle must not change it), and a disabled
          Button is a real <button disabled> the drivers cannot press (§7.367). */}
      <Button
        label={saving ? "Saving…" : "Save Attendance"}
        onPress={onSave}
        className="flex-1"
      />
    </View>
  );
}
