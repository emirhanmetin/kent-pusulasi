import { useEffect, useState } from 'react';

/** Değer, son değişiklikten `delay` ms sonra güncellenir (arama kutusu için). */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
