import { Settings, defaults, viewmodelFov, VM_FOV_MIN, VM_FOV_MAX, VM_OFFSET } from './settings';
import { gameLabel } from './hosted';
import { formatTime } from './timer';
import { bindLabel, wheelCode } from './input';
import { mapColours } from './mapPictures';

type HudOptions = {
  maps: { id: string; name: string; theme?: { zenith: string; horizon: string } }[];
  settings: Settings;
  onChange: (s: Settings) => void;
  onPlay: () => void;
  onCloseMenu: () => void;
  onQuit: (() => void) | null; // only the desktop app can close itself
  onUpdate: () => void;
  onRealImport: () => void;
  onRealRemove: () => void;
  boards: boolean; // this build has a leaderboard service
  onBoardOpen: (mapId?: string) => void;
  onGroupJoin: (code: string) => void;
  onCopyRecovery: () => void;
  onUseRecovery: (code: string) => void;
  onLoadFile: (file: File) => void;
  onShareCopy: () => void;
  onShareLoad: (code: string) => void;
  onReplay: () => void;
};

// How far a dragged window may sit from its place in the layout: on screen, so it can't get lost.
// A window taller than the screen scrolls instead, so it goes back to its own height.
export function fitOffset(x: number, y: number, want: { x: number; y: number }, r: { left: number; top: number; width: number; height: number }, vw: number, vh: number) {
  const homeX = r.left - x, homeY = r.top - y;
  return {
    x: Math.max(-homeX, Math.min(vw - r.width - homeX, want.x)),
    y: r.height > vh ? 0 : Math.max(-homeY, Math.min(vh - r.height - homeY, want.y)),
  };
}

// Small HUD glyphs, drawn in the HUD colour (currentColor).
const ICON = {
  speed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 7h9l-3-4h4l6 7-6 7H8l3-4H2z" fill="currentColor"/><path d="M14 7h3l6 5-6 5h-3l6-5z" fill="currentColor" opacity=".55"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 1h6v2.2A9.5 9.5 0 1 1 9 3.2zm3 5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zm-1 2h2v5.4l3.6 2.1-1 1.7-4.6-2.7z" fill="currentColor" fill-rule="evenodd"/></svg>',
  flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2h2v20H4zm3 1h13l-3 5 3 5H7z" fill="currentColor"/></svg>',
};
const TABS = [
  { id: 'map', name: 'Map' },
  { id: 'movement', name: 'Game' },
  { id: 'display', name: 'Display' },
  { id: 'knife', name: 'Knife' },
  { id: 'records', name: 'Records' },
  { id: 'board', name: 'Leaderboard' },
  { id: 'controls', name: 'Controls' },
];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function createHud(root: HTMLElement, opts: HudOptions) {
  let cur = opts.settings;
  // HUD after CS 1.6's bottom bar: speed where health was, the run timer where the round timer was, PB where money was.
  root.innerHTML = `
    <div class="flash" role="status" hidden></div>
    <div class="crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="fps" hidden></div>
    <p class="resumeHint" hidden>Click to play. Esc opens the menu.</p>
    <div class="consoleWrap" hidden>
      <section class="window console" role="dialog" aria-labelledby="consoleTitle">
        <header class="titlebar"><h2 id="consoleTitle">Console</h2><span class="gameName">help lists every command</span><button type="button" class="button closeBtn consoleClose" aria-label="Close console">×</button></header>
        <div class="consoleLog" role="log" tabindex="0"></div>
        <form class="consoleForm">
          <input class="consoleInput" autocomplete="off" spellcheck="false" aria-label="Console command" />
          <button class="button" type="submit">Submit</button>
        </form>
        <p class="consoleHint"></p>
      </section>
    </div>
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
    <section class="finishPanel" hidden aria-live="polite">
      <h2 class="finishTitle"></h2>
      <p class="finishTime"></p>
      <p class="finishDetail"></p>
      <p class="finishBoard"></p>
      <p class="finishKeys"></p>
    </section>
    <div class="start">
      <section class="window startBox" role="dialog" aria-labelledby="startTitle">
        <header class="titlebar"><h1 id="startTitle">Surf Sandbox</h1><span class="gameName"></span></header>
        <div class="mapCards">${opts.maps.filter((m) => m.theme).map((m) => {
            const [name, level] = m.name.split(/ \((.+)\)/);
            return `<button type="button" class="button mapCard" data-map="${esc(m.id)}"><i style="background:linear-gradient(90deg,${m.theme!.zenith},${m.theme!.horizon})"></i><strong>${esc(name)}</strong><small>${esc(level ?? '')}</small><span class="cardPlace"></span><span class="cardBest"></span></button>`;
          }).join('')}</div>
        <footer class="buttons">
          <button type="button" class="button startSettings">Options</button>
          <button type="button" class="button updateGame" hidden></button>
          <button type="button" class="button startPlay">Play</button>
        </footer>
      </section>
    </div>
    <div class="overlay" hidden>
      <section class="window" role="dialog" aria-labelledby="windowTitle">
        <header class="titlebar"><h1 id="windowTitle">Surf Sandbox</h1><span class="gameName"></span><button type="button" class="button closeBtn menuClose" aria-label="Close menu">×</button></header>
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
              <select name="game"><option value="csgo">${gameLabel('csgo')}</option><option value="cs16">${gameLabel('cs16')}</option></select>
            </label>
            <p class="note">Switches movement rules, knife and HUD together. Changing it restarts your run.</p>
            <label class="row"><span>Tickrate</span>
              <select name="tickrate"><option value="64">64</option><option value="128">128</option></select>
            </label>
            <p class="note tickHint"></p>
            <label class="row"><span>Mouse sensitivity</span><input name="sensitivity" type="number" min="0.01" max="20" step="0.01" /></label>
            <label class="row check"><input name="rawInput" type="checkbox" /><span>Raw mouse input</span></label>
            <label class="row check"><input name="autobhop" type="checkbox" /><span>Jump again automatically while holding jump</span></label>
          </div>
          <div class="sheet" role="tabpanel" id="sheet-display" aria-labelledby="tab-display" hidden>
            <label class="row"><span>Field of view</span>
              <span class="slider"><input name="fov" type="range" min="60" max="130" step="1" /><output name="fovOut"></output></span>
            </label>
            <label class="row"><span>HUD size</span>
              <span class="slider"><input name="hudScale" type="range" min="0.7" max="1.6" step="0.05" /><output name="hudScaleOut"></output></span>
            </label>
            <label class="row check"><input name="showSpeed" type="checkbox" /><span>Show speed on the HUD</span></label>
            <label class="row check"><input name="showGhost" type="checkbox" /><span>Race a ghost of your best run</span></label>
            <label class="row check"><input name="showViewmodel" type="checkbox" /><span>Show arms and knife</span></label>
            <label class="row check"><input name="speedFx" type="checkbox" /><span>Widen the view at high speed</span></label>
            <div class="vmBox">
              <p class="recentTitle">Arms and knife position</p>
              <label class="row"><span>Viewmodel FOV</span>
                <span class="slider"><input name="vmFov" type="range" min="${VM_FOV_MIN}" max="${VM_FOV_MAX}" step="1" /><output name="vmFovOut"></output></span>
              </label>
              <label class="row"><span>Left / right</span>
                <span class="slider"><input name="vmX" type="range" min="-${VM_OFFSET}" max="${VM_OFFSET}" step="0.25" /><output name="vmXOut"></output></span>
              </label>
              <label class="row"><span>Back / forward</span>
                <span class="slider"><input name="vmY" type="range" min="-${VM_OFFSET}" max="${VM_OFFSET}" step="0.25" /><output name="vmYOut"></output></span>
              </label>
              <label class="row"><span>Down / up</span>
                <span class="slider"><input name="vmZ" type="range" min="-${VM_OFFSET}" max="${VM_OFFSET}" step="0.25" /><output name="vmZOut"></output></span>
              </label>
              <label class="row check"><input name="vmLeft" type="checkbox" /><span>Hold the knife in the left hand</span></label>
              <div class="shareRow"><button type="button" class="button vmReset">Reset position</button></div>
            </div>
            <label class="row check"><input name="fullscreen" type="checkbox" /><span>Fullscreen while playing (holds the mouse in; hold Esc to leave)</span></label>
            <div class="realModels" hidden>
              <p class="recentTitle">Real CS models</p>
              <p class="note realNote" role="status"></p>
              <div class="shareRow">
                <button type="button" class="button realImport"></button>
                <button type="button" class="button realRemove" hidden>Back to built-in models</button>
              </div>
            </div>
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
            <p class="note noRecords">Finish a map to set your first record. Times are kept separately for ${gameLabel('csgo')} and ${gameLabel('cs16')}.</p>
            <table class="keylist records" hidden>
              <thead><tr><th scope="col">Map</th><th scope="col">Best</th><th scope="col">Finishes</th><th scope="col">Set on</th></tr></thead>
              <tbody></tbody>
            </table>
            <div class="shareBox">
              <p class="recentTitle">Race a friend</p>
              <div class="shareRow">
                <button type="button" class="button shareCopy">Copy my code for this map</button>
                <button type="button" class="button replayBtn">Watch my best run</button>
              </div>
              <div class="shareRow">
                <input class="shareInput" type="text" placeholder="Paste a friend's code" autocomplete="off" spellcheck="false" aria-label="Friend's code" />
                <button type="button" class="button shareLoad">Race</button>
              </div>
              <p class="note shareNote" role="status"></p>
            </div>
            <div class="recent" hidden>
              <p class="recentTitle"></p>
              <ol class="recentList"></ol>
            </div>
          </div>
          <div class="sheet" role="tabpanel" id="sheet-board" aria-labelledby="tab-board" hidden>
            <div class="board" hidden>
              <p class="boardTitle"></p>
              <div class="boardList">
                <table class="keylist boardMaps">
                  <thead><tr><th scope="col">Map</th><th scope="col">1st place</th><th scope="col">Time</th><th scope="col">You</th></tr></thead>
                  <tbody></tbody>
                </table>
              </div>
              <p class="boardMapTitle"></p>
              <table class="keylist boardRows" hidden>
                <thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Time</th><th scope="col">Medal</th></tr></thead>
                <tbody></tbody>
              </table>
              <p class="note boardNote" role="status"></p>
              <div class="shareRow">
                <input class="groupCode" type="text" placeholder="Group code" autocomplete="off" spellcheck="false" aria-label="Group code" />
                <button type="button" class="button groupJoin">Join</button>
              </div>
              <div class="boardAccount" hidden>
                <p class="note boardWho"></p>
                <div class="shareRow">
                  <button type="button" class="button copyRecovery">Copy my recovery code</button>
                  <input class="recoveryInput" type="text" placeholder="Recovery code from another PC" autocomplete="off" spellcheck="false" aria-label="Recovery code from another PC" />
                  <button type="button" class="button useRecovery">Use code</button>
                </div>
              </div>
            </div>
          </div>
          <div class="sheet" role="tabpanel" id="sheet-controls" aria-labelledby="tab-controls" hidden>
            <table class="keylist">
              <thead><tr><th scope="col">Action</th><th scope="col">Key</th></tr></thead>
              <tbody>
                <tr><td>Forward</td><td><button type="button" class="bindBtn keyBind" data-key="forward" title="Click, then press a key"></button></td></tr>
                <tr><td>Back</td><td><button type="button" class="bindBtn keyBind" data-key="back" title="Click, then press a key"></button></td></tr>
                <tr><td>Left</td><td><button type="button" class="bindBtn keyBind" data-key="left" title="Click, then press a key"></button></td></tr>
                <tr><td>Right</td><td><button type="button" class="bindBtn keyBind" data-key="right" title="Click, then press a key"></button></td></tr>
                <tr><td>Jump</td><td><button type="button" class="bindBtn" title="Click, then press a key or scroll"></button></td></tr>
                <tr><td>Walk</td><td><button type="button" class="bindBtn keyBind" data-key="walk" title="Click, then press a key"></button></td></tr>
                <tr><td>Crouch</td><td><button type="button" class="bindBtn keyBind" data-key="duck" title="Click, then press a key"></button></td></tr>
                <tr><td>Slash</td><td>Left click</td></tr>
                <tr><td>Stab</td><td>Right click</td></tr>
                <tr class="cs2Only"><td>Inspect knife</td><td>F</td></tr>
                <tr><td>Mark the finish (maps without one)</td><td>setgoal in the console</td></tr>
                <tr><td>Restart run</td><td>R</td></tr>
                <tr><td>Save checkpoint</td><td>1</td></tr>
                <tr><td>Teleport to checkpoint (practice)</td><td>2</td></tr>
                <tr><td>Step back to an earlier checkpoint</td><td>3</td></tr>
                <tr><td>Next map, after finishing</td><td>N</td></tr>
                <tr><td>Chat (type !help for commands)</td><td>Y</td></tr>
                <tr><td>Console (kill, retry, map, bind, sv_ settings: type help)</td><td>&#96; (key under Esc)</td></tr>
                <tr><td>Open or close this menu</td><td>Esc</td></tr>
              </tbody>
            </table>
            <p class="note credits">M9 Bayonet: <a href="https://sketchfab.com/3d-models/m9-bayonet-knife-6d6d3163afc8428b8a212d347ce01f39" target="_blank" rel="noopener">M9 Bayonet Knife</a> by ThomasEs. Arms: <a href="https://sketchfab.com/3d-models/none-296d30fc705b4dff85c2c8a2d2724e7f" target="_blank" rel="noopener">FREE [FPS Arms] GameReady - RIGGED</a> by bamenwo05. Karambit: <a href="https://sketchfab.com/3d-models/none-554aac0e619e45f0a95b7c15cac7219c" target="_blank" rel="noopener">Karambit Knife</a> by ediirawan. All <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>, posed and animated for this game (a simplified version of the arms in ${gameLabel('cs16')}).</p>
          </div>
        </form>
        <footer class="buttons">
          <button type="button" class="button quitGame" hidden>Quit game</button>
          <button type="button" class="button updateGame" hidden></button>
          <button type="button" class="button exitFullscreen" hidden>Exit fullscreen</button>
          <button class="play" type="button">Play</button>
        </footer>
      </section>
    </div>`;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const speed = $('.speed'), speedVal = $('.speedVal'), bestVal = $('.bestVal'), overlay = $('.overlay'), status = $('.status'), bindBtn = $<HTMLButtonElement>('.bindBtn:not(.keyBind)');
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
  const showViewmodelSettings = () => {
    el.vmFov.value = String(viewmodelFov(cur));
    el.vmFovOut.value = String(viewmodelFov(cur));
    for (const k of ['vmX', 'vmY', 'vmZ'] as const) {
      el[k].value = String(cur[k]);
      el[`${k}Out`].value = cur[k].toFixed(2);
    }
    el.vmLeft.checked = cur.vmLeft;
  };
  const showGame = () => {
    showViewmodelSettings();
    root.dataset.game = cur.game;
    root.querySelectorAll('.gameName').forEach((e) => (e.textContent = gameLabel(cur.game)));
    el.tickrate.disabled = cur.game === 'cs16';
    $('.tickHint').textContent = cur.game === 'cs16' ? `${gameLabel('cs16')} moves once per frame, at 100 fps.` : '';
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
    if (id === 'board' && !overlay.hidden) opts.onBoardOpen();
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
  $('#tab-board').hidden = !opts.boards;
  selectTab(TABS.some((t) => t.id === saved && (t.id !== 'board' || opts.boards)) ? saved! : 'map');
  showGame();
  el.autobhop.checked = cur.autobhop;
  el.showSpeed.checked = cur.showSpeed;
  el.showGhost.checked = cur.showGhost;
  el.showViewmodel.checked = cur.showViewmodel;
  el.speedFx.checked = cur.speedFx;
  el.rawInput.checked = cur.rawInput;
  el.fullscreen.checked = cur.fullscreen;
  if (!('keyboard' in navigator)) el.fullscreen.closest('label')!.style.display = 'none';
  el.hudScale.value = String(cur.hudScale);
  el.hudScaleOut.value = `${Math.round(cur.hudScale * 100)}%`;
  root.style.setProperty('--hud-scale', String(cur.hudScale));
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
    el.hudScaleOut.value = `${Math.round(Number(el.hudScale.value) * 100)}%`;
    root.style.setProperty('--hud-scale', el.hudScale.value);
    el.wearOut.value = wearLabel(Number(el.wear.value));
    const sens = parseFloat(el.sensitivity.value), seed = parseInt(el.seed.value, 10);
    change({
      name: e.target === el.name ? el.name.value : cur.name,
      map: el.map.value,
      sensitivity: Number.isFinite(sens) ? Math.min(20, Math.max(0.01, sens)) : cur.sensitivity,
      fov: Number(el.fov.value),
      vmFov: e.target === el.vmFov ? Number(el.vmFov.value) : cur.vmFov, // otherwise it follows the game's default
      vmX: Number(el.vmX.value),
      vmY: Number(el.vmY.value),
      vmZ: Number(el.vmZ.value),
      vmLeft: el.vmLeft.checked,
      tickrate: el.tickrate.value === '128' ? 128 : 64,
      game: el.game.value === 'cs16' ? 'cs16' : 'csgo',
      autobhop: el.autobhop.checked,
      showSpeed: el.showSpeed.checked,
      showGhost: el.showGhost.checked,
      showViewmodel: el.showViewmodel.checked,
      speedFx: el.speedFx.checked,
      rawInput: el.rawInput.checked,
      fullscreen: el.fullscreen.checked,
      hudScale: Number(el.hudScale.value),
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
  $('.realImport').addEventListener('click', opts.onRealImport);
  $('.realRemove').addEventListener('click', opts.onRealRemove);
  // Also turns the setting off, or the next Play would go straight back to fullscreen.
  const exitFullscreen = $('.exitFullscreen');
  const showExit = () => (exitFullscreen.hidden = !document.fullscreenElement);
  document.addEventListener('fullscreenchange', showExit);
  exitFullscreen.addEventListener('click', () => {
    el.fullscreen.checked = false;
    change({ fullscreen: false });
  });
  root.querySelectorAll('.updateGame').forEach((b) => b.addEventListener('click', opts.onUpdate));
  if (opts.onQuit) {
    const quit = $('.quitGame');
    quit.hidden = false;
    quit.addEventListener('click', opts.onQuit);
  }
  // Start screen: the map list drives the same setting as the menu's map picker.
  const start = $('.start'), cards = [...root.querySelectorAll<HTMLButtonElement>('.mapCard')];
  const markCard = () =>
    cards.forEach((c) => {
      const on = c.dataset.map === el.map.value;
      c.setAttribute('aria-pressed', String(on));
      if (on && !start.hidden) c.scrollIntoView({ block: 'nearest' }); // the list can be long: keep the picked map in view
    });
  const pickCard = (c: HTMLButtonElement) => {
    el.map.value = c.dataset.map!;
    el.map.dispatchEvent(new Event('input', { bubbles: true }));
    markCard();
  };
  cards.forEach((c) => c.addEventListener('click', () => pickCard(c)));
  markCard();
  $('.startPlay').addEventListener('click', () => {
    start.hidden = true;
    opts.onPlay();
  });
  let optionsFromStart = false;
  $('.startSettings').addEventListener('click', () => {
    optionsFromStart = true;
    start.hidden = true;
    overlay.hidden = false;
    if (tab === 'board') opts.onBoardOpen();
  });
  const finishPanel = $('.finishPanel');
  const groupCode = $<HTMLInputElement>('.groupCode');
  $('.vmReset').addEventListener('click', () => change({ vmFov: defaults.vmFov, vmX: defaults.vmX, vmY: defaults.vmY, vmZ: defaults.vmZ, vmLeft: defaults.vmLeft }));
  groupCode.value = cur.groupCode;
  const recoveryInput = $<HTMLInputElement>('.recoveryInput');
  $('.copyRecovery').addEventListener('click', opts.onCopyRecovery);
  $('.useRecovery').addEventListener('click', () => opts.onUseRecovery(recoveryInput.value));
  $('.groupJoin').addEventListener('click', () => opts.onGroupJoin(groupCode.value));
  groupCode.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    opts.onGroupJoin(groupCode.value);
  });
  $('.shareCopy').addEventListener('click', opts.onShareCopy);
  $('.replayBtn').addEventListener('click', opts.onReplay);
  $('.shareLoad').addEventListener('click', () => opts.onShareLoad($<HTMLInputElement>('.shareInput').value.trim()));
  const keyButtons = [...root.querySelectorAll<HTMLButtonElement>('.keyBind')];
  const showKeys = () => keyButtons.forEach((b) => (b.textContent = bindLabel(cur.keys[b.dataset.key as keyof Settings['keys']])));
  showKeys();
  keyButtons.forEach((b) =>
    b.addEventListener('click', () => {
      b.textContent = 'Press a key… (Esc cancels)';
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        window.removeEventListener('keydown', onKey, true);
        if (e.code !== 'Escape' && /^[A-Za-z0-9]{1,24}$/.test(e.code)) change({ keys: { ...cur.keys, [b.dataset.key!]: e.code } });
        showKeys();
      };
      window.addEventListener('keydown', onKey, true);
    }),
  );

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

  // Console: log + input with history (up/down) and Tab completion; ` or Esc closes it.
  const conWrap = $('.consoleWrap'), conLog = $('.consoleLog'), conForm = $<HTMLFormElement>('.consoleForm'), conInput = $<HTMLInputElement>('.consoleInput'), conHint = $('.consoleHint');
  const history: string[] = [];
  let histAt = 0, onConsoleLine: ((line: string) => void) | null = null, onConsoleClose: (() => void) | null = null, completer: (p: string) => string[] = () => [];
  const closeConsole = () => {
    if (conWrap.hidden) return;
    conWrap.hidden = true;
    conInput.blur();
    onConsoleClose?.();
  };
  $('.consoleClose').addEventListener('click', closeConsole);
  $('.menuClose').addEventListener('click', opts.onCloseMenu);
  // Drag a window by its title bar.
  const draggable = (win: HTMLElement) => {
    const bar = win.querySelector<HTMLElement>('.titlebar')!;
    let at = { x: 0, y: 0 }, grab: { x: number; y: number } | null = null;
    const place = (want: { x: number; y: number }) => {
      at = fitOffset(at.x, at.y, want, win.getBoundingClientRect(), innerWidth, innerHeight);
      win.style.transform = at.x || at.y ? `translate(${at.x}px, ${at.y}px)` : '';
    };
    bar.addEventListener('mousedown', (e) => e.preventDefault()); // the console keeps its typing focus, and no text gets selected
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as Element).closest('button')) return;
      grab = { x: e.clientX - at.x, y: e.clientY - at.y };
      bar.setPointerCapture(e.pointerId);
    });
    bar.addEventListener('pointermove', (e) => grab && place({ x: e.clientX - grab.x, y: e.clientY - grab.y }));
    const drop = () => (grab = null);
    bar.addEventListener('pointerup', drop);
    bar.addEventListener('pointercancel', drop);
    // Opening, a taller tab or a smaller browser could leave it off screen.
    new ResizeObserver(() => place(at)).observe(win);
    window.addEventListener('resize', () => place(at));
  };
  draggable(overlay.querySelector<HTMLElement>('.window')!);
  draggable(conWrap.querySelector<HTMLElement>('.window')!);
  const showHint = () => {
    const word = conInput.value.trimStart().split(/\s+/)[0] ?? '', hits = word && !conInput.value.includes(' ') ? completer(word) : [];
    conHint.textContent = hits.length ? hits.slice(0, 8).join('   ') + (hits.length > 8 ? `   (+${hits.length - 8} more)` : '') : '';
  };
  conForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const line = conInput.value.trim();
    conInput.value = '';
    showHint();
    if (!line) return;
    if (history.at(-1) !== line) history.push(line);
    histAt = history.length;
    conPrint(`] ${line}`, 'echo');
    onConsoleLine?.(line);
  });
  conInput.addEventListener('input', showHint);
  conInput.addEventListener('keydown', (e) => {
    e.stopPropagation(); // typed text, not game controls
    if (e.key === 'Escape' || e.code === 'Backquote' || e.key === '`') {
      e.preventDefault();
      closeConsole();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      histAt = Math.max(0, Math.min(history.length, histAt + (e.key === 'ArrowUp' ? -1 : 1)));
      conInput.value = history[histAt] ?? '';
    } else if (e.key === 'Tab') {
      // Complete the command name as far as all matches agree.
      e.preventDefault();
      const hits = completer(conInput.value.trim());
      if (!hits.length || conInput.value.includes(' ')) return;
      let common = hits[0];
      for (const h of hits) while (!h.startsWith(common)) common = common.slice(0, -1);
      conInput.value = hits.length === 1 ? hits[0] + ' ' : common.length >= conInput.value.trim().length ? common : conInput.value; // typo matches share no prefix
      showHint();
    }
  });
  const conPrint = (text: string, tone?: 'error' | 'dim' | 'echo') => {
    const line = document.createElement('div');
    line.textContent = text;
    if (tone) line.className = tone;
    conLog.append(line);
    while (conLog.children.length > 400) conLog.firstElementChild!.remove();
    conLog.scrollTop = conLog.scrollHeight;
  };

  let flashTimer = 0;
  return {
    consoleOpen: () => !conWrap.hidden,
    openConsole(onLine: (line: string) => void, complete: (prefix: string) => string[], onClose: () => void) {
      onConsoleLine = onLine;
      completer = complete;
      onConsoleClose = onClose;
      conWrap.hidden = false;
      conInput.focus();
      conLog.scrollTop = conLog.scrollHeight;
    },
    closeConsole,
    consolePrint: conPrint,
    consoleClear: () => conLog.replaceChildren(),
    setFps: (fps: number | null) => {
      $('.fps').hidden = fps === null;
      if (fps !== null) $('.fps').textContent = `${Math.round(fps)} fps`;
    },
    mapList: () => [...el.map.options].map((o) => ({ id: o.value, name: o.text })),
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
    setRecords(gameName: string, rows: { mapId: string; best: number; finishes: number; bestAt: number; medal: string | null }[], currentId: string, recent: { time: number; at: number }[]) {
      $('.recordsTitle').textContent = `Your ${gameName} records`;
      for (const c of cards) {
        const row = rows.find((r) => r.mapId === c.dataset.map);
        c.querySelector('.cardBest')!.textContent = row ? `${row.medal ? row.medal + '  ' : ''}${formatTime(row.best)}` : '';
      }
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
      $('.recent .recentTitle').textContent = `Last finishes on ${mapLabel(currentId)}`;
      $('.recentList').replaceChildren(
        ...recent.map((f) => {
          const li = document.createElement('li');
          li.textContent = `${formatTime(f.time)}${f.time === Math.min(...recent.map((x) => x.time)) ? '  (best of these)' : ''}`;
          return li;
        }),
      );
    },
    setSpeed(u: number) {
      speedVal.textContent = String(Math.round(u));
      speedVal.dataset.tier = u >= 3000 ? '3' : u >= 2000 ? '2' : u >= 1000 ? '1' : '';
    },
    setCardPicture(mapId: string, url: string) {
      const c = cards.find((x) => x.dataset.map === mapId)?.querySelector('i');
      if (c) c.style.background = `url("${url}") center / cover`;
    },
    busy: () => !$('.loading').hidden,
    // Your place on each map, on the start screen.
    setCardPlaces(places: Map<string, string>) {
      for (const c of cards) c.querySelector('.cardPlace')!.textContent = places.get(c.dataset.map!) ?? '';
    },
    // Every map at a glance, and the picked map's top 10. rows stay out of the way (empty) while note says what's going on.
    setBoard(b: { title: string; map: string; mapName: string; overview: { id: string; name: string; leader: string | null; time: number | null; place: number | null; myTime: number | null }[]; rows: { place: number; name: string; time: number; mine: boolean; medal: string | null }[]; note: string }) {
      $('.board').hidden = false;
      $('.boardTitle').textContent = b.title;
      const list = $('.boardList');
      const scroll = list.scrollTop;
      $('.boardMaps tbody').replaceChildren(
        ...b.overview.map((m) => {
          const tr = document.createElement('tr');
          if (m.id === b.map) tr.className = 'current';
          const pick = document.createElement('button');
          pick.type = 'button';
          pick.className = 'boardPick';
          pick.textContent = m.name;
          pick.addEventListener('click', () => opts.onBoardOpen(m.id));
          tr.insertCell().append(pick);
          tr.insertCell().textContent = m.leader ?? 'No times yet';
          tr.insertCell().textContent = m.time === null ? '' : formatTime(m.time);
          tr.insertCell().textContent = m.place === null ? '' : `#${m.place}  ${formatTime(m.myTime!)}`;
          return tr;
        }),
      );
      list.scrollTop = scroll;
      $('.boardMapTitle').textContent = b.rows.length ? `${b.mapName}: top 10` : b.mapName;
      $('.boardNote').textContent = b.note;
      const table = $('.boardRows');
      table.hidden = b.rows.length === 0;
      table.querySelector('tbody')!.replaceChildren(
        ...b.rows.map((r) => {
          const tr = document.createElement('tr');
          if (r.mine) tr.className = 'current';
          for (const text of [String(r.place), r.name, formatTime(r.time), r.medal ?? '']) tr.insertCell().textContent = text;
          return tr;
        }),
      );
    },
    // The desktop app's Steam import. importLabel null: nothing to import from.
    setRealModels(r: { note: string; importLabel: string | null; canRemove: boolean }) {
      $('.realModels').hidden = false;
      $('.realNote').textContent = r.note;
      $('.realImport').hidden = !r.importLabel;
      $('.realImport').textContent = r.importLabel ?? '';
      $('.realRemove').hidden = !r.canRemove;
    },
    // Who this player is on the boards. null: no group yet; empty: in a group, no name claimed yet.
    setBoardAccount(name: string | null) {
      $('.boardAccount').hidden = name === null;
      $('.copyRecovery').hidden = !name;
      $('.boardWho').textContent = name ? `You're "${name}" on the boards.` : 'Played here before? Your recovery code brings your name and times back.';
    },
    clearRecoveryInput: () => (recoveryInput.value = ''),
    showUpdate(label: string) {
      root.querySelectorAll<HTMLButtonElement>('.updateGame').forEach((b) => ((b.hidden = false), (b.textContent = label)));
    },
    setBoardNote: (text: string) => ($('.boardNote').textContent = text),
    setFinishBoard: (text: string) => ($('.finishBoard').textContent = text),
    setShareNote: (msg: string) => ($('.shareNote').textContent = msg),
    showOverlay(show: boolean) {
      overlay.hidden = !show;
      if (show && tab === 'board') opts.onBoardOpen();
    },
    startOpen: () => !start.hidden,
    showStart(show: boolean) {
      start.hidden = !show;
      optionsFromStart = false;
    },
    // Esc in Options opened from the start screen goes back there.
    backToStart() {
      if (!optionsFromStart) return false;
      overlay.hidden = true;
      this.showStart(true);
      return true;
    },
    // The end of a run. The mouse is locked in play, so its actions are keys.
    showFinish(f: { title: string; time: string; detail: string; speed: number; tone: 'good' | 'bad'; next: string | null } | null) {
      finishPanel.hidden = !f;
      $('.finishBoard').textContent = '';
      if (!f) return;
      $('.finishTitle').textContent = f.title;
      $('.finishTime').textContent = f.time;
      const detail = $('.finishDetail');
      detail.textContent = [f.detail, `max ${f.speed} u/s`].filter(Boolean).join('   ');
      detail.className = `finishDetail ${f.tone}`;
      $('.finishKeys').textContent = `R  retry${f.next ? `      N  next: ${f.next}` : ''}`;
    },
    showResume: (show: boolean) => ($('.resumeHint').hidden = !show),
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
    // A permitted map from licensed-maps/: on the start list, and in the credits.
    addLicensedMap(m: { id: string; name: string; difficulty?: string; credit: string; source?: string }) {
      this.addMap({ id: m.id, name: m.name }, false, m.difficulty);
      if (!m.credit) return;
      const line = document.createElement('p');
      line.className = 'note credits';
      if (m.source && /^https:\/\//.test(m.source)) {
        const a = document.createElement('a');
        (a.href = m.source), (a.target = '_blank'), (a.rel = 'noopener'), (a.textContent = m.name);
        line.append(a, ` ${m.credit}`);
      } else line.textContent = `${m.name} ${m.credit}`;
      root.querySelector('.credits')!.after(line);
    },
    addMap(m: { id: string; name: string }, select = true, difficulty = '') {
      if (![...el.map.options].some((o) => o.value === m.id)) el.map.add(new Option(m.name, m.id));
      if (!cards.some((c) => c.dataset.map === m.id)) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'button mapCard';
        card.dataset.map = m.id;
        card.innerHTML = '<i></i><strong></strong><small></small><span class="cardPlace"></span><span class="cardBest"></span>';
        card.querySelector('strong')!.textContent = m.name.replace(/^(CS:GO|Imported): /, '');
        card.querySelector('small')!.textContent = difficulty;
        card.querySelector('i')!.style.background = mapColours(m.name);
        card.addEventListener('click', () => pickCard(card));
        $('.mapCards').append(card);
        cards.push(card);
        markCard();
      }
      if (!select) return;
      el.map.value = m.id;
      cur = { ...cur, map: m.id };
    },
  };
}
