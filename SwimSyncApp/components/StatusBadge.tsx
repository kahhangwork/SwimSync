import React from "react";
import { View, Text } from "react-native";

type Status =
  | "Present"
  | "Absent"
  | "Cancelled"
  | "Trial"
  | "Outstanding"
  | "Paid"
  | "Credit Applied"
  | "Assigned"
  | "Unassigned"
  | "Inactive"
  | "Applied"
  | "Not Marked"
  | string;

const statusConfig: Record<string, { bg: string; text: string; label?: string }> = {
  Present:        { bg: "bg-green-100",  text: "text-green-700" },
  Absent:         { bg: "bg-gray-100",   text: "text-gray-500" },
  Cancelled:      { bg: "bg-orange-100", text: "text-orange-600" },
  Trial:          { bg: "bg-blue-100",   text: "text-blue-600" },
  Outstanding:    { bg: "bg-red-100",    text: "text-red-600" },
  Paid:           { bg: "bg-green-100",  text: "text-green-700" },
  "Credit Applied": { bg: "bg-blue-100", text: "text-blue-600" },
  Applied:        { bg: "bg-blue-100",   text: "text-blue-600" },
  Assigned:       { bg: "bg-green-100",  text: "text-green-700" },
  Unassigned:     { bg: "bg-yellow-100", text: "text-yellow-700" },
  Inactive:       { bg: "bg-gray-100",   text: "text-gray-500" },
  "Not Marked":   { bg: "bg-gray-100",   text: "text-gray-400", label: "–" },
};

interface Props {
  status: Status;
  size?: "sm" | "md";
}

export default function StatusBadge({ status, size = "md" }: Props) {
  const config = statusConfig[status] ?? { bg: "bg-gray-100", text: "text-gray-500" };
  const label = config.label ?? status;
  const textSize = size === "sm" ? "text-xs" : "text-sm";
  const px = size === "sm" ? "px-2 py-0.5" : "px-3 py-1";

  return (
    <View className={`rounded-full ${config.bg} ${px} self-start`}>
      <Text className={`${config.text} ${textSize} font-semibold`}>{label}</Text>
    </View>
  );
}
