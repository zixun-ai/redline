import { useEffect, useState } from "react";

/** Keeps the last truthy value for `ms` after it clears, so whatever shows it can animate out. */
export function useLinger<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (value) { setShown(value); return; }
    const t = setTimeout(() => setShown(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return value || shown;
}
