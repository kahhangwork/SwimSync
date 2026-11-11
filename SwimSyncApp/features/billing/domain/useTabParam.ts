// Applies `?tab=` to the Billing tab switcher. An EFFECT on the param, not a
// useState initialiser: Billing is a tab, so the screen is usually already
// mounted when the link is followed, and an initialiser would never re-run.
import { useEffect } from "react";
import { useLocalSearchParams } from "expo-router";
import type { Tab } from "../types";
import { tabFromParam } from "./tabParam";

export function useTabParam(setActiveTab: (t: Tab) => void) {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  useEffect(() => {
    const t = tabFromParam(tab);
    if (t) setActiveTab(t);
  }, [tab, setActiveTab]);
}
