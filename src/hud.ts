import type { Settings } from './settings';
import { bindLabel, wheelCode } from './input';

type HudOptions = {
  maps: { id: string; name: string }[];
  settings: Settings;
  onChange: (s: Settings) => void;
  onPlay: () => void;
  onLoadFile: (file: File) => void;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function createHud(root: HTMLElement, opts: HudOptions) {
  let cur = opts.settings;
  root.innerHTML = `
    <div class="timer"><span class="time">0:00.000</span><span class="best"></span></div>
    <div class="flash" hidden></div>
    <div class="crosshair"></div>
    <div class="speed">0</div>
    <div class="overlay">
      <div class="panel">
        <h1>Surf Sandbox</h1>
        <button class="play" type="button">Play</button>
        <form class="options">
          <label>Map
            <select name="map">${opts.maps.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select>
          </label>
          <div class="load">
            <label class="file">Load CS:GO map (.bsp)…<input name="file" type="file" accept=".bsp" /></label>
            <p class="status" role="status"></p>
          </div>
          <label>Sensitivity <span class="hint">(CS:GO scale)</span>
            <input name="sensitivity" type="number" min="0.01" max="20" step="0.01" />
          </label>
          <label>FOV <output name="fovOut"></output>
            <input name="fov" type="range" min="60" max="130" step="1" />
          </label>
          <label>Tickrate
            <select name="tickrate"><option value="64">64</option><option value="128">128</option></select>
          </label>
          <label class="knifePick" hidden>Knife
            <select name="knife"></select>
          </label>
          <div class="finishOpts" hidden>
            <label>Finish
              <select name="finish"></select>
            </label>
            <label>Wear <output name="wearOut"></output>
              <input name="wear" type="range" min="0" max="1" step="0.001" />
            </label>
            <label>Pattern seed <span class="hint">(0–1000)</span>
              <input name="seed" type="number" min="0" max="1000" step="1" />
            </label>
          </div>
          <div class="bind">Jump <button type="button" class="bindBtn"></button></div>
          <label class="check"><input name="autobhop" type="checkbox" /> Auto-bhop (hold jump)</label>
          <label class="check"><input name="showSpeed" type="checkbox" /> Show speed</label>
        </form>
        <p class="keys">WASD move · Mouse look · Shift walk · C crouch · R restart · F set goal (imported maps) · Esc menu</p>
      </div>
    </div>`;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const speed = $('.speed'), overlay = $('.overlay'), status = $('.status'), bindBtn = $<HTMLButtonElement>('.bindBtn');
  const time = $('.time'), best = $('.best'), flash = $('.flash');
  const form = $<HTMLFormElement>('.options');
  const el = form.elements as unknown as Record<string, HTMLInputElement & HTMLSelectElement & HTMLOutputElement>;

  el.map.value = cur.map;
  el.sensitivity.value = String(cur.sensitivity);
  el.fov.value = String(cur.fov);
  el.fovOut.value = String(cur.fov);
  el.tickrate.value = String(cur.tickrate);
  el.autobhop.checked = cur.autobhop;
  el.showSpeed.checked = cur.showSpeed;
  el.wear.value = String(cur.wear);
  el.seed.value = String(cur.seed);
  const wearLabel = (w: number) => `${w.toFixed(3)} · ${w < 0.07 ? 'Factory New' : w < 0.15 ? 'Minimal Wear' : w < 0.38 ? 'Field-Tested' : w < 0.45 ? 'Well-Worn' : 'Battle-Scarred'}`;
  el.wearOut.value = wearLabel(cur.wear);
  bindBtn.textContent = bindLabel(cur.jumpBind);
  speed.hidden = !cur.showSpeed;

  const change = (patch: Partial<Settings>) => {
    cur = { ...cur, ...patch };
    speed.hidden = !cur.showSpeed;
    opts.onChange(cur);
  };

  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', (e) => {
    if (e.target === el.file) return;
    el.fovOut.value = el.fov.value;
    el.wearOut.value = wearLabel(Number(el.wear.value));
    const sens = parseFloat(el.sensitivity.value), seed = parseInt(el.seed.value, 10);
    change({
      map: el.map.value,
      sensitivity: Number.isFinite(sens) ? Math.min(20, Math.max(0.01, sens)) : cur.sensitivity,
      fov: Number(el.fov.value),
      tickrate: el.tickrate.value === '128' ? 128 : 64,
      autobhop: el.autobhop.checked,
      showSpeed: el.showSpeed.checked,
      knife: el.knife.value || cur.knife,
      // An unchanged finish list keeps the saved finish even if this knife doesn't offer it.
      finish: e.target === el.finish ? el.finish.value : cur.finish,
      wear: Number(el.wear.value),
      seed: Number.isFinite(seed) ? Math.min(1000, Math.max(0, seed)) : cur.seed,
    });
  });
  el.file.addEventListener('change', () => {
    const f = el.file.files?.[0];
    if (f) opts.onLoadFile(f);
    el.file.value = '';
  });
  $('.play').addEventListener('click', opts.onPlay);

  // Rebind: the next key press or wheel notch becomes the jump bind; Esc cancels.
  bindBtn.addEventListener('click', () => {
    bindBtn.textContent = 'Press a key or scroll… (Esc cancels)';
    const done = (code: string | null) => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', onWheel, true);
      if (code) change({ jumpBind: code });
      bindBtn.textContent = bindLabel(cur.jumpBind);
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      done(e.code === 'Escape' || !/^[A-Za-z0-9]{1,24}$/.test(e.code) ? null : e.code);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      done(wheelCode(e.deltaY));
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  });

  let flashTimer = 0;
  return {
    setSpeed: (u: number) => (speed.textContent = String(Math.round(u))),
    showOverlay: (show: boolean) => (overlay.hidden = !show),
    setTimer(t: string, bestText: string) {
      time.textContent = t;
      best.textContent = bestText;
    },
    flash(msg: string) {
      flash.textContent = msg;
      flash.hidden = false;
      clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => (flash.hidden = true), 3000);
    },
    setStatus(msg: string, error = false) {
      status.textContent = msg;
      status.classList.toggle('error', error);
    },
    // Knives come from the local CS2 import, so the picker only appears once they're known.
    setKnives(list: { id: string; name: string }[]) {
      el.knife.replaceChildren(...list.map((k) => new Option(k.name, k.id)));
      el.knife.value = list.some((k) => k.id === cur.knife) ? cur.knife : (list[0]?.id ?? '');
      $('.knifePick').hidden = list.length === 0;
    },
    // The current knife's finishes; the controls hide for knives without any (default knives).
    setFinishes(list: { id: string; name: string }[]) {
      el.finish.replaceChildren(new Option('Vanilla', ''), ...list.map((f) => new Option(f.name, f.id)));
      el.finish.value = list.some((f) => f.id === cur.finish) ? cur.finish : '';
      $('.finishOpts').hidden = list.length === 0;
    },
    addMap(m: { id: string; name: string }, select = true) {
      if (![...el.map.options].some((o) => o.value === m.id)) el.map.add(new Option(m.name, m.id));
      if (!select) return;
      el.map.value = m.id;
      cur = { ...cur, map: m.id };
    },
  };
}
