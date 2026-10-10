import React from "react";
import { View, Image, ViewProps } from "react-native";

/**
 * The SwimSync mark — a wave flowing into a tick (DESIGN.md → Logo, concept 2a).
 *
 * Rendered from a PNG rather than an SVG component on purpose: the app has no
 * `react-native-svg` dependency, and adding a native module to a project that
 * has not cut a native build yet is a risk this does not need. The asset is a
 * white knockout shipped at @1x/@2x/@3x, so `tintColor` recolours it for any
 * ground. Canonical vector source is `brand/mark.svg` at the repo root; the PNGs
 * in `assets/` are rasterised from it (see `brand/README.md`).
 */

interface Props extends ViewProps {
  /**
   * `lg` is the primary auth screens (login, welcome), `md` the secondary ones
   * (register, password reset), `sm` inline chrome. These match the tile sizes
   * the screens already used, so swapping the mark in changes no layout.
   */
  size?: "sm" | "md" | "lg";
  /** Colour of the mark itself. Defaults to white, for use on the Lane Blue tile. */
  tint?: string;
  className?: string;
}

// The mark is ~70% of its tile, as in the app icon (brand/icon-tile.svg): it is
// wide and flat, so the pace clock's ~60% left it looking lost in the tile.
const SIZES = {
  sm: { box: "w-10 h-10 rounded-xl", mark: 28 },
  md: { box: "w-14 h-14 rounded-2xl", mark: 40 },
  lg: { box: "w-16 h-16 rounded-2xl", mark: 46 },
} as const;

export default function Logo({
  size = "lg",
  tint = "#ffffff",
  className = "",
  ...rest
}: Props) {
  const { box, mark } = SIZES[size];

  return (
    <View
      className={`bg-blue-600 items-center justify-center ${box} ${className}`}
      // Decorative. Every call site sits the mark next to text that already
      // names the product, so labelling it here just announces "SwimSync"
      // twice. The admin twin renders its SVG `aria-hidden` for the same reason.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      {...rest}
    >
      <Image
        source={require("../assets/logo-mark.png")}
        style={{ width: mark, height: mark, tintColor: tint }}
        resizeMode="contain"
      />
    </View>
  );
}
