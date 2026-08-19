// The class colour palette — the ONLY place a `classes.colour` key is given a
// meaning.
//
// `classes.colour` stores a palette KEY ("sky", "rose", …), never a hex value
// (20260819000100: CHECK `^[a-z]{3,12}$`). Twelve fixed swatches, chosen so
// the card text stays readable on every one; a free colour picker was refused
// for exactly that reason. An unknown or NULL key renders NEUTRAL — a class
// whose colour was set under a palette this build no longer has must still be
// visible on the calendar, not invisible or crashed.
//
// Tailwind class strings are written out in full (no template interpolation):
// the content scanner only keeps literal class names it can see.

export type ClassColour = {
  key: string;
  label: string;
  /** Card background + left border + text, for a calendar card. */
  card: string;
  /** A small solid dot / swatch. */
  dot: string;
  /** Ring shown on the selected swatch in the picker. */
  ring: string;
};

export const NEUTRAL_COLOUR: ClassColour = {
  key: "neutral",
  label: "No colour",
  card: "bg-gray-100 border-gray-400 text-gray-800",
  dot: "bg-gray-400",
  ring: "ring-gray-400",
};

export const CLASS_COLOURS: readonly ClassColour[] = [
  { key: "sky",     label: "Sky",     card: "bg-sky-100 border-sky-500 text-sky-900",          dot: "bg-sky-500",     ring: "ring-sky-500" },
  { key: "blue",    label: "Blue",    card: "bg-blue-100 border-blue-600 text-blue-900",       dot: "bg-blue-600",    ring: "ring-blue-600" },
  { key: "indigo",  label: "Indigo",  card: "bg-indigo-100 border-indigo-500 text-indigo-900", dot: "bg-indigo-500",  ring: "ring-indigo-500" },
  { key: "violet",  label: "Violet",  card: "bg-violet-100 border-violet-500 text-violet-900", dot: "bg-violet-500",  ring: "ring-violet-500" },
  { key: "fuchsia", label: "Fuchsia", card: "bg-fuchsia-100 border-fuchsia-500 text-fuchsia-900", dot: "bg-fuchsia-500", ring: "ring-fuchsia-500" },
  { key: "rose",    label: "Rose",    card: "bg-rose-100 border-rose-500 text-rose-900",       dot: "bg-rose-500",    ring: "ring-rose-500" },
  { key: "orange",  label: "Orange",  card: "bg-orange-100 border-orange-500 text-orange-900", dot: "bg-orange-500",  ring: "ring-orange-500" },
  { key: "amber",   label: "Amber",   card: "bg-amber-100 border-amber-500 text-amber-900",    dot: "bg-amber-500",   ring: "ring-amber-500" },
  { key: "lime",    label: "Lime",    card: "bg-lime-100 border-lime-600 text-lime-900",       dot: "bg-lime-600",    ring: "ring-lime-600" },
  { key: "emerald", label: "Emerald", card: "bg-emerald-100 border-emerald-600 text-emerald-900", dot: "bg-emerald-600", ring: "ring-emerald-600" },
  { key: "teal",    label: "Teal",    card: "bg-teal-100 border-teal-600 text-teal-900",       dot: "bg-teal-600",    ring: "ring-teal-600" },
  { key: "cyan",    label: "Cyan",    card: "bg-cyan-100 border-cyan-600 text-cyan-900",       dot: "bg-cyan-600",    ring: "ring-cyan-600" },
];

const BY_KEY = new Map(CLASS_COLOURS.map((c) => [c.key, c]));

/** The swatch for a stored key. NULL / unknown → NEUTRAL, never undefined. */
export function colourFor(key: string | null | undefined): ClassColour {
  if (!key) return NEUTRAL_COLOUR;
  return BY_KEY.get(key) ?? NEUTRAL_COLOUR;
}

/** True when `key` is one this build can render — what the picker may offer. */
export function isKnownColourKey(key: string): boolean {
  return BY_KEY.has(key);
}
