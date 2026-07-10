import React from "react";
import { View, Text } from "react-native";

interface Props {
  title: string;
  subtitle?: string;
}

export default function SectionHeader({ title, subtitle }: Props) {
  return (
    <View className="mb-4">
      <Text className="text-xl font-bold text-gray-900">{title}</Text>
      {subtitle ? (
        <Text className="text-sm text-gray-500 mt-0.5">{subtitle}</Text>
      ) : null}
    </View>
  );
}
