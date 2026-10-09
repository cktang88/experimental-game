// Node stand-ins for the browser globals game modules touch at import time. Import this first.
const store = new Map<string, string>();
const g = globalThis as any;
if (!g.localStorage) g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() };
export const memoryStore = store;
