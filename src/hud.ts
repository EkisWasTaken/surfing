import type { Settings } from './settings';
import { formatTime } from './timer';
import { bindLabel, wheelCode } from './input';

type HudOptions = {
  maps: { id: string; name: string }[];
  settings: Settings;
  onChange: (s: Settings) => void;
  onPlay: () => void;
  onLoadFile: (file: File) => void;
};

// Small HUD glyphs, drawn in the HUD colour (currentColor).
const ICON = {
  speed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 7h9l-3-4h4l6 7-6 7H8l3-4H2z" fill="currentColor"/><path d="M14 7h3l6 5-6 5h-3l6-5z" fill="currentColor" opacity=".55"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 1h6v2.2A9.5 9.5 0 1 1 9 3.2zm3 5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zm-1 2h2v5.4l3.6 2.1-1 1.7-4.6-2.7z" fill="currentColor" fill-rule="evenodd"/></svg>',
  flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2h2v20H4zm3 1h13l-3 5 3 5H7z" fill="currentColor"/></svg>',
};
const TABS = [
  { id: 'map', name: 'Map' },
  { id: 'movement', name: 'Movement' },
  { id: 'knife', name: 'Knife' },
  { id: 'records', name: 'Records' },
  { id: 'controls', name: 'Controls' },
];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function createHud(root: HTMLElement, opts: HudOptions) {
  let cur = opts.settings;
  // HUD after CS 1.6's bottom bar: speed where health was, the run timer where the round timer was, PB where money was.
  root.innerHTML = `
    <div class="flash" role="status" hidden></div>
    <div class="crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="chat" aria-live="polite"></div>
    <form class="say" hidden><label for="sayInput">say :</label><input id="sayInput" maxlength="127" autocomplete="off" spellcheck="false" /></form>
    <div class="loading" role="dialog" aria-labelledby="loadingTitle" hidden>
      <section class="window loadingWindow">
        <header class="titlebar"><h2 id="loadingTitle" class="loadingGame"></h2></header>
        <div class="loadingBody">
          <p class="loadingMap"></p>
          <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="progressFill"></div></div>
          <p class="loadingStep"></p>
        </div>
      </section>
    </div>
    <div class="hudbar">
      <div class="hudItem speed" aria-label="Speed">${ICON.speed}<span class="speedVal">0</span><small>u/s</small></div>
      <div class="hudItem timer" aria-label="Run time">${ICON.clock}<span class="time">0:00.000</span><small class="practiceTag" hidden>practice</small></div>
      <div class="hudItem best" aria-label="Personal best" hidden>${ICON.flag}<span class="bestVal"></span></div>
    </div>
    <div class="overlay">
      <section class="window" role="dialog" aria-labelledby="windowTitle">
        <header class="titlebar"><h1 id="windowTitle">Surf Sandbox</h1><span class="gameName"></span></header>
        <div class="tabs" role="tablist" aria-label="Menu sections">
          ${TABS.map((t) => `<button type="button" role="tab" id="tab-${t.id}" aria-controls="sheet-${t.id}" data-tab="${t.id}">${t.name}</button>`).join('')}
        </div>
        <form class="options">
          <div class="sheet" role="tabpanel" id="sheet-map" aria-labelledby="tab-map">
            <label class="row"><span>Your name</span><input name="name" type="text" maxlength="31" autocomplete="nickname" spellcheck="false" /></label>
            <label class="row"><span>Map</span>
              <select name="map">${opts.maps.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select>
            </label>
            <div class="row"><span>Your own map</span>
              <label class="button file">Load .bsp file…<input name="file" type="file" accept=".bsp" /></label>
            </div>
            <p class="status" role="status"></p>
          </div>
          <div class="sheet" role="tabpanel" id="sheet-movement" aria-labelledby="tab-movement" hidden>
            <label class="row"><span>Game</span>
              <select name="game"><option value="csgo">CS:GO</option><option value="cs16">CS 1.6</option></select>
            </label>
            <p class="note">Switches movement rules, knife and HUD together. Changing it restarts your run.</p>
            <label class="row"><span>Tickrate</span>
              <select name="tickrate"><option value="64">64</option><option value="128">128</option></select>
            </label>
            <p class="note tickHint"></p>
            <label class="row"><span>Mouse sensitivity</span><input name="sensitivity" type="number" min="0.01" max="20" step="0.01" /></label>
            <label class="row"><span>Field of view</span>
              <span class="slider"><input name="fov" type="range" min="60" max="130" step="1" /><output name="fovOut"></output></span>
            </label>
            <label class="row check"><input name="autobhop" type="checkbox" /><span>Jump again automatically while holding jump</span></label>
            <label class="row check"><input name="showSpeed" type="checkbox" /><span>Show speed on the HUD</span></label>
            <label class="row check"><input name="showGhost" type="checkbox" /><span>Race a ghost of your best run</span></label>
          </div>
          <div class="sheet" role="tabpanel" id="sheet-knife" aria-labelledby="tab-knife" hidden>
            <p class="note noKnives">Knives appear after running <code>npm run import-maps</code> with CS2 installed.</p>
            <label class="row knifePick" hidden><span>Knife</span><select name="knife"></select></label>
            <div class="finishOpts" hidden>
              <label class="row"><span>Finish</span><select name="finish"></select></label>
              <label class="row"><span>Wear</span>
                <span class="slider"><input name="wear" type="range" min="0" max="1" step="0.001" /><output name="wearOut"></output></span>
              </label>
              <label class="row"><span>Pattern seed</span><input name="seed" type="number" min="0" max="1000" step="1" /></label>
            </div>
          </div>
          <div class="sheet" role="tabpanel" id="sheet-records" aria-labelledby="tab-records" hidden>
            <p class="recordsTitle"></p>
            <p class="note noRecords">Finish a map to set your first record. Times are kept separately for CS:GO and CS 1.6.</p>
            <table class="keylist records" hidden>
              <thead><tr><th scope="col">Map</th><th scope="col">Best</th><th scope="col">Finishes</th><th scope="col">Set on</th></tr></thead>
              <tbody></tbody>
            </table>
            <div class="recent" hidden>
              <p class="recentTitle"></p>
              <ol class="recentList"></ol>
            </div>
          </div>
          <div class="sheet" role="tabpanel" id="sheet-controls" aria-labelledby="tab-controls" hidden>
            <table class="keylist">
              <thead><tr><th scope="col">Action</th><th scope="col">Key</th></tr></thead>
              <tbody>
                <tr><td>Move</td><td>W A S D</td></tr>
                <tr><td>Jump</td><td><button type="button" class="bindBtn" title="Click, then press a key or scroll"></button></td></tr>
                <tr><td>Walk</td><td>Shift</td></tr>
                <tr><td>Crouch</td><td>C</td></tr>
                <tr><td>Slash</td><td>Left click</td></tr>
                <tr><td>Stab</td><td>Right click</td></tr>
                <tr class="cs2Only"><td>Inspect knife</td><td>F</td></tr>
                <tr><td>Mark the finish (maps without one)</td><td>F</td></tr>
                <tr><td>Restart run</td><td>R</td></tr>
                <tr><td>Save checkpoint</td><td>1</td></tr>
                <tr><td>Teleport to checkpoint (practice)</td><td>2</td></tr>
                <tr><td>Chat (type !help for commands)</td><td>Y</td></tr>
                <tr><td>Open this menu</td><td>Esc</td></tr>
              </tbody>
            </table>
          </div>
        </form>
        <footer class="buttons"><button class="play" type="button">Play</button></footer>
      </section>
    </div>`;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const speed = $('.speed'), speedVal = $('.speedVal'), bestVal = $('.bestVal'), overlay = $('.overlay'), status = $('.status'), bindBtn = $<HTMLButtonElement>('.bindBtn');
  const time = $('.time'), best = $('.best'), flash = $('.flash');
  const form = $<HTMLFormElement>('.options');
  const el = form.elements as unknown as Record<string, HTMLInputElement & HTMLSelectElement & HTMLOutputElement>;

  el.map.value = cur.map;
  el.sensitivity.value = String(cur.sensitivity);
  el.name.value = cur.name;
  el.fov.value = String(cur.fov);
  el.fovOut.value = String(cur.fov);
  el.tickrate.value = String(cur.tickrate);
  el.game.value = cur.game;
  // The whole UI wears the chosen game's look: CS 1.6 VGUI or CS:GO.
  const showGame = () => {
    root.dataset.game = cur.game;
    $('.gameName').textContent = cur.game === 'cs16' ? 'Counter-Strike 1.6' : 'CS:GO';
    el.tickrate.disabled = cur.game === 'cs16';
    $('.tickHint').textContent = cur.game === 'cs16' ? 'CS 1.6 moves once per frame, at 100 fps.' : '';
    $('.tickHint').hidden = cur.game !== 'cs16';
    // CS 1.6 has one knife and no skins, and no inspect.
    root.querySelectorAll<HTMLElement>('.cs2Only').forEach((e) => (e.hidden = cur.game === 'cs16'));
    $('#tab-knife').hidden = cur.game === 'cs16';
    if (cur.game === 'cs16' && tab === 'knife') selectTab('map');
  };
  // Tabs: click or arrow keys; the open tab is remembered on this device.
  const tabButtons = [...root.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  let tab = 'map';
  const selectTab = (id: string, focus = false) => {
    tab = id;
    for (const b of tabButtons) {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    root.querySelectorAll<HTMLElement>('.sheet').forEach((p) => (p.hidden = p.id !== `sheet-${id}`));
    try {
      localStorage.setItem('surf-menu-tab', id);
    } catch {}
  };
  tabButtons.forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab!)));
  $('.tabs').addEventListener('keydown', (e) => {
    const shown = tabButtons.filter((b) => !b.hidden), i = shown.findIndex((b) => b.dataset.tab === tab);
    const next = e.key === 'ArrowRight' ? shown[(i + 1) % shown.length] : e.key === 'ArrowLeft' ? shown[(i - 1 + shown.length) % shown.length] : null;
    if (next) (e.preventDefault(), selectTab(next.dataset.tab!, true));
  });
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('surf-menu-tab');
  } catch {}
  selectTab(TABS.some((t) => t.id === saved) ? saved! : 'map');
  showGame();
  el.autobhop.checked = cur.autobhop;
  el.showSpeed.checked = cur.showSpeed;
  el.showGhost.checked = cur.showGhost;
  el.wear.value = String(cur.wear);
  el.seed.value = String(cur.seed);
  const wearLabel = (w: number) => `${w.toFixed(3)}, ${w < 0.07 ? 'Factory New' : w < 0.15 ? 'Minimal Wear' : w < 0.38 ? 'Field-Tested' : w < 0.45 ? 'Well-Worn' : 'Battle-Scarred'}`;
  el.wearOut.value = wearLabel(cur.wear);
  el.fovOut.value = String(cur.fov);
  bindBtn.textContent = bindLabel(cur.jumpBind);
  speed.hidden = !cur.showSpeed;

  const change = (patch: Partial<Settings>) => {
    cur = { ...cur, ...patch };
    showGame();
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
      name: e.target === el.name ? el.name.value : cur.name,
      map: el.map.value,
      sensitivity: Number.isFinite(sens) ? Math.min(20, Math.max(0.01, sens)) : cur.sensitivity,
      fov: Number(el.fov.value),
      tickrate: el.tickrate.value === '128' ? 128 : 64,
      game: el.game.value === 'cs16' ? 'cs16' : 'csgo',
      autobhop: el.autobhop.checked,
      showSpeed: el.showSpeed.checked,
      showGhost: el.showGhost.checked,
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

  // Chat: CS 1.6-style lines (tag, name, text), newest at the bottom, each fading out after a while.
  const chat = $('.chat');
  const CHAT_LINES = 6, CHAT_SECONDS = 10;
  // Loading dialog, after CS 1.6's connection progress box.
  const loading = $('.loading'), progress = $('.progress'), progressFill = $('.progressFill');
  const day = (at: number) => (at ? new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'before records were kept');
  const mapLabel = (id: string) => ([...el.map.options].find((o) => o.value === id)?.text ?? id.replace(/^bsp:/, '').replace(/\.bsp$/i, '')).replace(/^CS:GO: /, '');

  // Typing in chat (CS's messagemode): Enter sends, Esc or leaving the field cancels.
  const say = $<HTMLFormElement>('.say'), sayInput = $<HTMLInputElement>('#sayInput');
  let onSaid: ((text: string) => void) | null = null, onSayClosed: (() => void) | null = null;
  const closeSay = () => {
    if (say.hidden) return;
    say.hidden = true;
    sayInput.value = '';
    sayInput.blur();
    onSayClosed?.();
  };
  say.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = sayInput.value;
    closeSay();
    if (text.trim()) onSaid?.(text.trim());
  });
  sayInput.addEventListener('keydown', (e) => {
    e.stopPropagation(); // keys typed here are text, not game controls
    if (e.key === 'Escape') closeSay();
  });
  sayInput.addEventListener('blur', closeSay);

  let flashTimer = 0;
  return {
    // A map id whose name contains the query (chat's !map), preferring an exact name.
    findMap(query: string) {
      const q = query.toLowerCase().trim(), opts = [...el.map.options];
      const name = (o: HTMLOptionElement) => o.text.toLowerCase().replace(/^cs:go: /, '');
      return (opts.find((o) => name(o) === q) ?? opts.find((o) => name(o).includes(q)))?.value ?? null;
    },
    openSay(onSend: (text: string) => void, onClose: () => void) {
      onSaid = onSend;
      onSayClosed = onClose;
      say.hidden = false;
      sayInput.focus();
    },
    // Settings changed from outside the menu (chat commands): update the form, then apply like a menu change.
    apply(patch: Partial<Settings>) {
      for (const [k, v] of Object.entries(patch)) {
        const field = el[k];
        if (!field) continue;
        if ((field as HTMLInputElement).type === 'checkbox') (field as HTMLInputElement).checked = Boolean(v);
        else field.value = String(v);
      }
      change(patch);
    },
    chat(parts: { text: string; tone?: 'tag' | 'name' | 'good' | 'bad' }[]) {
      const line = document.createElement('p');
      line.style.setProperty('--life', `${CHAT_SECONDS}s`);
      for (const p of parts) {
        const span = document.createElement('span');
        span.textContent = p.text;
        if (p.tone) span.className = p.tone;
        line.append(span);
      }
      chat.append(line);
      while (chat.children.length > CHAT_LINES) chat.firstElementChild!.remove();
      setTimeout(() => line.remove(), CHAT_SECONDS * 1000);
    },
    // null hides the dialog; fraction 0..1 drives the segmented bar.
    loading(state: { game: string; map: string; step: string; fraction: number } | null) {
      loading.hidden = !state;
      if (!state) return;
      $('.loadingGame').textContent = state.game;
      $('.loadingMap').textContent = `Loading "${state.map}"`;
      $('.loadingStep').textContent = state.step;
      const pct = Math.round(Math.min(1, Math.max(0, state.fraction)) * 100);
      progress.setAttribute('aria-valuenow', String(pct));
      progressFill.style.width = `${pct}%`;
    },
    // Records for the current game; the current map's last finishes underneath.
    setRecords(gameName: string, rows: { mapId: string; best: number; finishes: number; bestAt: number }[], currentId: string, recent: { time: number; at: number }[]) {
      $('.recordsTitle').textContent = `Your ${gameName} records`;
      $('.noRecords').hidden = rows.length > 0;
      const table = $('.records');
      table.hidden = rows.length === 0;
      table.querySelector('tbody')!.replaceChildren(
        ...rows.map((r) => {
          const tr = document.createElement('tr');
          if (r.mapId === currentId) tr.className = 'current';
          for (const text of [mapLabel(r.mapId), formatTime(r.best), String(r.finishes), day(r.bestAt)]) tr.insertCell().textContent = text;
          return tr;
        }),
      );
      $('.recent').hidden = recent.length === 0;
      $('.recentTitle').textContent = `Last finishes on ${mapLabel(currentId)}`;
      $('.recentList').replaceChildren(
        ...recent.map((f) => {
          const li = document.createElement('li');
          li.textContent = `${formatTime(f.time)}${f.time === Math.min(...recent.map((x) => x.time)) ? '  (best of these)' : ''}`;
          return li;
        }),
      );
    },
    setSpeed: (u: number) => (speedVal.textContent = String(Math.round(u))),
    showOverlay: (show: boolean) => (overlay.hidden = !show),
    setTimer(t: string, bestText: string, practice = false) {
      $('.practiceTag').hidden = !practice;
      time.textContent = t;
      bestVal.textContent = bestText.replace(/^PB /, '');
      best.hidden = !bestText;
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
      $('.noKnives').hidden = list.length > 0;
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
