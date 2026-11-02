// The desktop app's Steam import, off the main thread. The decoders read files synchronously, and a worker's
// synchronous requests can return bytes, so they run unchanged against the app's local file service (src-tauri).
import { runImport } from './steam-import';
import { STEAM } from './hosted';

const q = encodeURIComponent;
function request(method: string, url: string, body?: string | Uint8Array, bytes = true) {
  const x = new XMLHttpRequest();
  x.open(method, url, false);
  if (bytes) x.responseType = 'arraybuffer';
  x.send(body as XMLHttpRequestBodyInit | undefined);
  if (x.status !== 200) throw new Error(`${method} ${url}: ${x.status}`);
  return x;
}
const bytesOf = (url: string) => new Uint8Array(request('GET', url).response as ArrayBuffer);
const textOf = (url: string) => request('GET', url, undefined, false).responseText;

self.onmessage = async (e: MessageEvent<{ csgo: string | null; halfLife: string | null }>) => {
  const maps: string[] = [];
  try {
    const result = await runImport(
      {
        exists: (path) => textOf(`${STEAM}/exists?path=${q(path)}`) === 'true',
        read: (path) => bytesOf(`${STEAM}/read?path=${q(path)}`),
        readRange: (path, offset, length) => bytesOf(`${STEAM}/read?path=${q(path)}&offset=${offset}&len=${length}`),
        write: (file, data) => void request('POST', `${STEAM}/cache?p=${q(file)}`, data),
        // Maps aren't copied: the app reads them straight from the game folder.
        prepareMaps(mapsDir) {
          const found = (JSON.parse(textOf(`${STEAM}/list?path=${q(mapsDir)}`)) as string[]).filter((f) => /^surf_.*\.bsp$/i.test(f)).sort();
          maps.push(...found);
          return found.map((file) => ({ file, path: `${mapsDir}/${file}` }));
        },
      },
      e.data,
      (line, fraction) => self.postMessage({ line, fraction }),
    );
    request('POST', `${STEAM}/cache?p=${q('maps/index.json')}`, JSON.stringify(maps));
    self.postMessage({ done: result });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
