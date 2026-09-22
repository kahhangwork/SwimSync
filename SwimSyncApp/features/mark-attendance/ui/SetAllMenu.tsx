// The Set-all dropdown. The ROUTE renders it LAST so it stacks above the list.
// Moved VERBATIM from app/(coach)/classes/[id]/attendance.tsx
// (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 6); props destructured on the first line so
// the JSX is byte-identical (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity, Pressable } from "react-native";
import { SET_ALL_OPTIONS, type BulkOption } from "@/lib/attendanceBulk";

export default function SetAllMenu(p: {
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
  onSetAll: (opt: BulkOption) => void;
}) {
  const { menuOpen, setMenuOpen, onSetAll } = p;
  return (
    <>
      {/* Set-all dropdown (rendered last so it stacks above the list) */}
      {menuOpen && (
        <>
          <Pressable
            onPress={() => setMenuOpen(false)}
            className="absolute left-0 right-0 top-0 bottom-0 z-40"
          />
          <View className="absolute right-5 top-14 z-50 w-52 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg">
            {SET_ALL_OPTIONS.map((opt, i) => (
              <TouchableOpacity
                key={opt.label}
                onPress={() => onSetAll(opt)}
                className={`flex-row items-center gap-2.5 px-4 py-3 ${
                  i > 0 ? "border-t border-gray-100" : ""
                }`}
              >
                <View className={`h-2.5 w-2.5 rounded-full ${opt.dot}`} />
                <Text className="text-sm text-gray-800">{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </>
  );
}
