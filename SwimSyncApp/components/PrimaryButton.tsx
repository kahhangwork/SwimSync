import React from "react";
import { TouchableOpacity, Text, TouchableOpacityProps } from "react-native";

interface Props extends TouchableOpacityProps {
  label: string;
  variant?: "primary" | "outline" | "ghost";
}

export default function PrimaryButton({
  label,
  variant = "primary",
  className = "",
  ...rest
}: Props) {
  const base = "rounded-xl py-3.5 px-6 items-center justify-center";
  const styles = {
    primary: `${base} bg-sky-500`,
    outline: `${base} border-2 border-sky-500`,
    ghost:   `${base}`,
  }[variant];

  const textStyles = {
    primary: "text-white font-semibold text-base",
    outline: "text-sky-500 font-semibold text-base",
    ghost:   "text-sky-500 font-semibold text-base",
  }[variant];

  return (
    <TouchableOpacity className={`${styles} ${className}`} activeOpacity={0.8} {...rest}>
      <Text className={textStyles}>{label}</Text>
    </TouchableOpacity>
  );
}
