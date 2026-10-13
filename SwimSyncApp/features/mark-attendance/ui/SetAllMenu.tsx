// The Set-all dropdown. The ROUTE renders it LAST so it stacks above the list.
// Moved from app/(coach)/classes/[id]/attendance.tsx (COACH_ATTENDANCE_REFACTOR_PLAN.md,
// Stage 6). Since UI restyle step 2.2 its toggle is in the bottom action area, so the
// menu opens UPWARD from there (bottom-20 clears the 68px footer).
import React from "react";
import { View, Text, TouchableOpacity, Pressable } from "react-native";
import { SET_ALL_OPTIONS, type BulkOption } from "@/lib/attendanceBulk";
import { BULK_DOT } from "../constants";

export default function SetAllMenu(p: {
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
  onSetAll: (opt: BulkOption) => void;
}) {
  const { menuOpen, setMenuOpen, onSetAll } = p;
  return (
    <>
      {menuOpen && (
        <>
          <Pressable
            onPress={() => setMenuOpen(false)}
            className="absolute left-0 right-0 top-0 bottom-0 z-40"
          />
          <View className="absolute left-5 bottom-20 z-50 w-56 overflow-hidden rounded-card border border-border bg-surface shadow-float">
            {SET_ALL_OPTIONS.map((opt, i) => (
              <TouchableOpacity
                key={opt.label}
                onPress={() => onSetAll(opt)}
                className={
                  i > 0
                    ? "min-h-11 flex-row items-center gap-2.5 px-4 border-t border-divider"
                    : "min-h-11 flex-row items-center gap-2.5 px-4"
                }
              >
                <View className={BULK_DOT[opt.top]} />
                <Text className="text-body text-ink">{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </>
  );
}
