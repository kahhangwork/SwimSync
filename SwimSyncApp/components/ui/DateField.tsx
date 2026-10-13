// A date picked, not typed (DESIGN.md → Inputs: "Picking a month or a date is a
// picker, never a free-text field"). UI restyle step 3.6, with no new package (plan
// D7): on the web — where the app is live — the browser's own date input; on a
// native build, still the YYYY-MM-DD text field until a picker package is approved.
//
// The value in and out is the SAME `YYYY-MM-DD` string the old text field wrote: a
// date input's value is exactly that ("" when cleared), and it is passed through as
// the browser gives it — never rebuilt through a Date, which would shift it a day
// in SGT (§7.7). The callers' validation is unchanged.
//
// The DOM input is styled inline with DESIGN.md's token values: it is not a React
// Native element, so NativeWind's className does not reach it.
import React from "react";
import { Platform, TextInput } from "react-native";

const INPUT = "min-h-11 border border-border-strong rounded-control px-3 text-body text-ink bg-surface";

const WEB_INPUT: React.CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  minHeight: 44,
  padding: "0 12px",
  border: "1px solid #d4d4d4", // Border Strong
  borderRadius: 6,
  background: "#ffffff", // Surface
  color: "#0a0a0a", // Ink
  fontFamily: "inherit",
  fontSize: 14,
};

export function DateField({
  value,
  onChange,
  accessibilityLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  accessibilityLabel: string;
}) {
  if (Platform.OS === "web") {
    return (
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Kept from the text field: the UI drivers find the field by it.
        placeholder="YYYY-MM-DD"
        aria-label={accessibilityLabel}
        style={WEB_INPUT}
      />
    );
  }
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="YYYY-MM-DD"
      accessibilityLabel={accessibilityLabel}
      className={INPUT}
      placeholderTextColor="#6b6b6b"
    />
  );
}
