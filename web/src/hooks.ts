import { useEffect, useState } from "react";
import { api, type AppConfig } from "./api";

let cached: Promise<AppConfig> | null = null;

export function useConfig(): AppConfig | null {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  useEffect(() => {
    cached ??= api.config();
    cached.then(setCfg).catch(() => setCfg(null));
  }, []);
  return cfg;
}

/** Re-run `load` every `ms` while `active` is true. */
export function usePoll<T>(load: () => Promise<T>, ms: number, deps: unknown[], active: (v: T | null) => boolean = () => true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      try {
        const v = await load();
        if (!alive) return;
        setData(v);
        setError(null);
        if (active(v)) timer = setTimeout(run, ms);
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message);
        timer = setTimeout(run, ms * 2);
      }
    };
    run();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}
