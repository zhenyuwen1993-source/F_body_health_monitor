"use client";

import { useCallback, useSyncExternalStore } from "react";

// A boolean remembered in localStorage. useSyncExternalStore keeps the server
// and first client render agreeing (both false) and avoids setting state from
// an effect just to read storage.

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function useLocalFlag(key: string, fallback = false): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : raw === "1";
      } catch {
        return fallback;
      }
    },
    () => fallback, // server snapshot
  );

  const set = useCallback(
    (v: boolean) => {
      try {
        localStorage.setItem(key, v ? "1" : "0");
      } catch {
        // Private mode — the change just won't persist.
      }
      for (const cb of listeners) cb();
    },
    [key],
  );

  return [value, set];
}
