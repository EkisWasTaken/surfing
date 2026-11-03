// The small pictures in the map picker. Each player's own game draws them from the map itself and keeps them in this
// browser, so nothing from a map ever ships with the game. Until a picture exists, a map shows colours from its name.

const KEY = 'surf-map-picture:';

export function loadPicture(mapId: string) {
  try {
    return localStorage.getItem(KEY + mapId);
  } catch {
    return null;
  }
}
export function savePicture(mapId: string, url: string) {
  try {
    localStorage.setItem(KEY + mapId, url);
  } catch {} // storage full or blocked: drawn again next time
}

// The same two colours for a map on every PC, spread around the wheel so neighbours in the list look different.
export function mapColours(name: string) {
  let h = 2166136261;
  for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const hue = (h >>> 0) % 360;
  return `linear-gradient(135deg,hsl(${hue} 55% 58%),hsl(${(hue + 40) % 360} 60% 26%))`;
}

// How much there is to see in a rendered view (RGBA bytes): detail counts most, and it must not be too dark or blown out.
export function scoreView(pixels: Uint8Array) {
  let sum = 0, squares = 0;
  const n = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    const lum = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    sum += lum;
    squares += lum * lum;
  }
  const mean = sum / n, spread = Math.sqrt(Math.max(0, squares / n - mean * mean));
  const exposure = 1 - Math.abs(mean - 120) / 120; // 1 at a good brightness, 0 at black or white
  return spread * Math.max(0, exposure);
}
