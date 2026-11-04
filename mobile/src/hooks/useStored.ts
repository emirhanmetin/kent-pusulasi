import { useCallback, useEffect, useState } from 'react';

import { readJson, writeJson } from '@/lib/storage';

/**
 * Telefonda kalıcı durum: ilk açılışta dosyadan okunur, her değişiklikte yazılır.
 * `ready` false iken değer henüz dosyadan okunmamıştır.
 */
export function useStored<T>(name: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    readJson<T>(name, initial).then((v) => {
      if (!alive) return;
      setValue(v);
      setReady(true);
    });
    return () => {
      alive = false;
    };
    // initial yalnızca ilk okuma için
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          writeJson(name, v);
        } catch {
          /* depolama hatası: bellekte yine de güncel kalsın */
        }
        return v;
      });
    },
    [name],
  );

  return [value, update, ready] as const;
}
