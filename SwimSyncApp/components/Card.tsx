import React from "react";
import { View, ViewProps } from "react-native";

interface Props extends ViewProps {
  children: React.ReactNode;
  className?: string;
}

export default function Card({ children, className = "", ...rest }: Props) {
  return (
    <View
      className={`bg-white rounded-2xl p-4 shadow-sm border border-gray-100 ${className}`}
      {...rest}
    >
      {children}
    </View>
  );
}
