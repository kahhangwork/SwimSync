// DESIGN.md's buttons (UI restyle step 1.3). The legacy
// components/PrimaryButton went in 7.1.
//
// Every class string below is a FULL literal in a Record: Tailwind keeps only a
// class it can read whole in the source, so `bg-${x}` is purged with no error
// (§7.191). lib/uiPrimitives.drift.test.ts reads this file and holds that.
import React from "react";
import { TouchableOpacity, Text, type TouchableOpacityProps } from "react-native";
import { confirmAction } from "@/lib/confirm";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "link";

const BOX: Record<ButtonVariant, string> = {
  primary: "min-h-11 px-4 rounded-control items-center justify-center bg-primary",
  secondary: "min-h-11 px-4 rounded-control items-center justify-center bg-surface border border-border-strong",
  destructive: "min-h-11 px-4 rounded-control items-center justify-center bg-surface border border-border-strong",
  link: "min-h-11 justify-center",
};

const LABEL: Record<ButtonVariant, string> = {
  primary: "text-body font-semibold text-white",
  secondary: "text-body font-semibold text-ink",
  destructive: "text-body font-semibold text-status-danger-text",
  link: "text-body font-semibold text-primary",
};

const DISABLED_BOX: Record<ButtonVariant, string> = {
  primary: "min-h-11 px-4 rounded-control items-center justify-center bg-status-neutral-bg",
  secondary: "min-h-11 px-4 rounded-control items-center justify-center bg-status-neutral-bg",
  destructive: "min-h-11 px-4 rounded-control items-center justify-center bg-status-neutral-bg",
  link: "min-h-11 justify-center",
};

const DISABLED_LABEL = "text-body font-semibold text-ink-muted";

/** With an icon the box lays its two children out in a row. */
const WITH_ICON = "flex-row gap-2";

type Common = Omit<TouchableOpacityProps, "onPress" | "children"> & {
  label: string;
  /** Rendered BESIDE the label, never around it — see the note on the Text. */
  icon?: React.ReactNode;
  onPress?: () => void;
};

/** A destructive button cannot be built without its confirmation step. */
type Props =
  | (Common & { variant?: "primary" | "secondary" | "link" })
  | (Common & {
      variant: "destructive";
      confirm: { title: string; message: string; confirmLabel?: string };
    });

export function Button(props: Props) {
  const { label, icon, onPress, className = "", disabled, ...rest } = props;
  const variant = props.variant ?? "primary";
  // Strip the non-DOM props so they never reach the host element.
  const passThrough = { ...rest } as Record<string, unknown>;
  delete passThrough.variant;
  delete passThrough.confirm;

  const press =
    props.variant === "destructive"
      ? () => {
          const { title, message, confirmLabel } = props.confirm;
          // confirmAction, never Alert.alert — that is a no-op on RN-web.
          confirmAction(title, message, () => onPress?.(), confirmLabel);
        }
      : onPress;

  // ⚠ With the button role, a disabled Button is a real <button disabled> on
  // RN-web and a driver cannot click it at all (§7.367) — check a control's
  // drivers before moving it onto this component with `disabled`.
  const box = disabled ? DISABLED_BOX[variant] : BOX[variant];
  const text = disabled ? DISABLED_LABEL : LABEL[variant];

  return (
    <TouchableOpacity
      className={`${box} ${icon ? WITH_ICON : ""} ${className}`}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={press}
      {...passThrough}
    >
      {icon}
      {/* The label is the pressable's DIRECT child: the UI drivers' pressByText
          dispatches on the matched text's parent, so a wrapping View would
          swallow every press (§7.365). */}
      <Text className={text}>{label}</Text>
    </TouchableOpacity>
  );
}
