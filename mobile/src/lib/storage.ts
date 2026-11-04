// Telefonda kalıcı JSON saklama (uygulamanın belge klasörü). Buluşma noktası, favoriler, çevrimdışı veri...
// Veriler yalnızca cihazda kalır; sunucuya gönderilmez.
import { File, Paths } from 'expo-file-system';

const fileFor = (name: string) => new File(Paths.document, `${name}.json`);

export async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    const f = fileFor(name);
    if (!f.exists) return fallback;
    return JSON.parse(await f.text()) as T;
  } catch {
    return fallback; // bozuk dosya: varsayılana dön
  }
}

export function writeJson(name: string, value: unknown): void {
  const f = fileFor(name);
  if (value === null || value === undefined) {
    if (f.exists) f.delete();
    return;
  }
  if (!f.exists) f.create();
  f.write(JSON.stringify(value));
}
