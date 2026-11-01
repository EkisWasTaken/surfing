import type { Settings } from './settings';

type HudOptions = {
  maps: { id: string; name: string }[];
  settings: Settings;
  onChange: (s: Settings) => void;
  onPlay: () => void;
};

export function createHud(root: HTMLElement, opts: HudOptions) {
  const s = opts.settings;
  root.innerHTML = `
    <div class="crosshair"></div>
    <div class="speed">0</div>
    <div class="overlay">
      <div class="panel">
        <h1>Surf Sandbox</h1>
        <button class="play" type="button">Play</button>
        <form class="options">
          <label>Map
            <select name="map">${opts.maps.map((m) => `<option value="${m.id}">${m.name}</option>`).join('')}</select>
          </label>
          <label>Sensitivity <span class="hint">(CS:GO scale)</span>
            <input name="sensitivity" type="number" min="0.01" max="20" step="0.01" />
          </label>
          <label>FOV <output name="fovOut"></output>
            <input name="fov" type="range" min="60" max="130" step="1" />
          </label>
          <label>Tickrate
            <select name="tickrate"><option value="64">64</option><option value="128">128</option></select>
          </label>
          <label class="check"><input name="autobhop" type="checkbox" /> Auto-bhop (hold space)</label>
          <label class="check"><input name="showSpeed" type="checkbox" /> Show speed</label>
        </form>
        <p class="keys">WASD move · Mouse look · Space jump · C/Shift crouch · R respawn · Esc menu</p>
      </div>
    </div>`;
  const speed = root.querySelector<HTMLElement>('.speed')!;
  const overlay = root.querySelector<HTMLElement>('.overlay')!;
  const form = root.querySelector<HTMLFormElement>('.options')!;
  const el = form.elements as unknown as Record<string, HTMLInputElement & HTMLSelectElement & HTMLOutputElement>;

  el.map.value = s.map;
  el.sensitivity.value = String(s.sensitivity);
  el.fov.value = String(s.fov);
  el.fovOut.value = String(s.fov);
  el.tickrate.value = String(s.tickrate);
  el.autobhop.checked = s.autobhop;
  el.showSpeed.checked = s.showSpeed;
  speed.hidden = !s.showSpeed;

  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', () => {
    el.fovOut.value = el.fov.value;
    const sens = parseFloat(el.sensitivity.value);
    const next: Settings = {
      map: el.map.value,
      sensitivity: Number.isFinite(sens) ? Math.min(20, Math.max(0.01, sens)) : s.sensitivity,
      fov: Number(el.fov.value),
      tickrate: el.tickrate.value === '128' ? 128 : 64,
      autobhop: el.autobhop.checked,
      showSpeed: el.showSpeed.checked,
    };
    speed.hidden = !next.showSpeed;
    opts.onChange(next);
  });
  root.querySelector('.play')!.addEventListener('click', opts.onPlay);

  return {
    setSpeed: (u: number) => (speed.textContent = String(Math.round(u))),
    showOverlay: (show: boolean) => (overlay.hidden = !show),
  };
}
