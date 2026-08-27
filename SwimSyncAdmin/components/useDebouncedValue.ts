import { useEffect, useState } from "react";

/**
 * Debounce a rapidly-changing value (a search box's text) so an effect that
 * depends on it does not fire on every keystroke.
 *
 * WHY IT EXISTS: the admin table searches run in the DATABASE (⚠ RISK 3 —
 * `lib/tableSearch.ts`), so each change of the term is a network round trip.
 * Debouncing turns "type five characters" from five queries into one.
 *
 * The initial value passes through with NO delay (the debounced value starts
 * equal to `value`), so a page's first-load fetch is not held back by the
 * debounce — only subsequent edits wait `delayMs`.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
