import './style.css';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import karambitModel from './assets/viewmodel/karambit.glb?url';
import m9Model from './assets/viewmodel/m9.glb?url';
import retroModel from './assets/viewmodel/retro.glb?url';
import { HOSTED, OWN_MODELS, DESKTOP, USING_REAL, REAL_UNDECIDED, STEAM, assetUrl, setUsingReal, gameLabel, gameTitle, parseGame } from './hosted';
import { config, modeDefault } from './config';
import { vec, add, sub, scale, angleVectors, normalize } from './math';
import { maps as builtins, findMap } from './maps';
import { medalFor } from './maps/build';
import type { MapDef } from './maps';
import { bspToMap, goalBox, loadGoal, saveGoal, sharedFinish } from './maps/imported';
import { parseBsp } from './bsp';
import { readZip } from './pak';
import type { VtexJson } from './cs2model';
import { unb64 } from './b64';
import licensedMaps from '../licensed-maps/manifest.json';
import type { Track } from './records';
import { createLeaderboard, loadAccount, saveAccount, WRONG_CODE, NAME_TAKEN, BAD_TOKEN } from './leaderboard';
import { createGrid } from './grid';
import { newPlayer, unstick, Player } from './movement';
import { simTick, touching, newTickState } from './sim';
import { createAccumulator, tickYaw } from './loop';
import { newPose, stepPose } from './viewmodelPose';
import { createInput } from './input';
import { createRenderer } from './render';
import { createHud } from './hud';
import { newRun, tickRun, formatTime, Run } from './timer';
import { loadRecords, saveRecords, recordFinish, recordKey, recordTrack, finishKind, FinishResult } from './records';
import { ghostFromTicks, sampleGhost, ghostSeconds, loadGhost, saveGhost, encodeShare, decodeShare, Ghost, Shared } from './ghost';
import { createConsole, keyName, Print } from './console';
import { Settings, loadSettings, saveSettings, applySettings, defaults } from './settings';

// three.js needs WebGL 2. Without it the game can't start, so say so rather than leave a blank page.
if (!document.createElement('canvas').getContext('webgl2')) {
  document.body.innerHTML = '<p style="margin:0;padding:15vh 24px;font:18px/1.5 system-ui,sans-serif;text-align:center;color:#eee;background:#222;min-height:100vh;box-sizing:border-box">This game needs WebGL 2, and your browser couldn\'t start it.<br>Turn on hardware acceleration in your browser\'s settings, or try another browser.</p>';
  throw new Error('WebGL 2 is not available');
}
const licensedFiles = import.meta.glob('/licensed-maps/*.bsp', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const licensedUrl = (file: string) => licensedFiles[`/licensed-maps/${file}`] as string | undefined;
const licensed = licensedMaps as { file: string; name: string; author: string; permission: string; source?: string; difficulty?: string; finish?: number[] }[];
const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const input = createInput(canvas);
const renderer = createRenderer(canvas);
const maps: (MapDef & { goalFromMap?: boolean })[] = [...builtins];

let settings = loadSettings();
const wantedMap = settings.map; // may be a maps-folder map, loaded once the folder list arrives
let map = findMap(settings.map);
settings = { ...settings, map: map.id };
applySettings(settings);
input.setJumpBind(settings.jumpBind);
renderer.setFov(settings.fov);
let acc = createAccumulator(1 / config.tickrate);
let grid = createGrid(map.brushes);
let prev: Player, cur: Player;
let run: Run = newRun();
let records = loadRecords();
let ghost: Ghost | null = null; // your best run on this map in this game
let recording: number[] = []; // x, y, z, yaw per tick of the current run
let practice = false; // a checkpoint teleport this run: it can't be a record
let boardMap = ''; // the map picked on the Records tab; empty follows the map you're on
let maxSpeed = 0;
let typing = false; // chat or console input open
let noclip = false; // console noclip: fly through walls (practice)
let showFps = false;
let stageNow = 0; // the stage a fall returns you to
let finishShown = false;
let splits: number[] = []; // stage times of the current run
let rival: Shared | null = null; // a friend's run being raced, for this map
let replayStart = -1; // watching your best run: when it started
let fovKick = 0;
const runTrack = () => recordTrack(settings.game, settings.tickrate);
const best = () => records[recordKey(runTrack(), map.id)]?.best ?? null; // per game and tick rate: their times aren't comparable
let simState = newTickState(); // once-pushes, health and hurt timing carried between ticks
let pose = newPose(); // knife bob/sway
let lastFrameView = { yaw: 0, pitch: 0 };
let lastTickYaw = 0; // yaw the previous tick used, for spreading mouse turn across ticks

function respawn() {
  stageNow = 0;
  splits = [];
  if (finishShown) (hud.showFinish(null), (finishShown = false));
  prev = cur = newPlayer(map.spawn);
  simState = newTickState();
  practice = false;
  noclip = false; // like CS: dying ends noclip
  input.setView(map.spawnYaw, 0);
  lastTickYaw = map.spawnYaw;
  run = newRun();
}

function useMap(m: MapDef) {
  boardMap = '';
  map = m;
  if (rival && rival.map !== m.id) rival = null;
  grid = createGrid(m.brushes);
  m.spawn = unstick(m.spawn, m.brushes);
  const textures = renderer.setMap(m);
  ghost = loadGhost(runTrack(), m.id);
  respawn();
  return textures;
}
useMap(map);

const tauri = (window as unknown as { __TAURI__?: { core: { invoke(cmd: string): Promise<unknown> } } }).__TAURI__; // set only inside the desktop app
const hud = createHud(document.querySelector<HTMLElement>('#hud')!, {
  maps,
  settings,
  onPlay: input.requestLock,
  onCloseMenu: () => closeMenu(),
  onRealImport: () => importRealModels(),
  onRealRemove: () => void removeRealModels(),
  onQuit: tauri ? () => void tauri.core.invoke('quit') : null,
  onUpdate: () => installUpdate(),
  onBoardOpen: (mapId) => void showBoard(mapId),
  onGroupJoin: (code) => void joinGroup(code),
  onCopyRecovery: () => copyRecovery(),
  onUseRecovery: (code) => void useRecovery(code),
  onChange(next: Settings) {
    const mapChanged = next.map !== settings.map, tickChanged = next.tickrate !== settings.tickrate || next.game !== settings.game;
    const gameChanged = next.game !== settings.game;
    const knifeChanged = next.knife !== settings.knife;
    const finishChanged = next.finish !== settings.finish || next.wear !== settings.wear || next.seed !== settings.seed;
    settings = next;
    applySettings(next);
    saveSettings(next);
    renderer.setShowViewmodel(next.showViewmodel);
    input.setJumpBind(next.jumpBind);
    input.setFullscreen(next.fullscreen);
    input.setRawInput(next.rawInput);
    input.setKeys(next.keys);
    renderer.setFov(next.fov);
    if (tickChanged) acc = createAccumulator(1 / config.tickrate);
    if (gameChanged) renderer.setGame(next.game);
    if (gameChanged && next.game === 'cs16') loadClassic();
    if (tickChanged) ghost = loadGhost(runTrack(), map.id);
    if (tickChanged && !mapChanged) respawn(); // hulls and rules differ: start the run over under the new ones
    if (tickChanged && !mapChanged) (announceMap(), refreshRecords());
    if (gameChanged || (tickChanged && rival && rival.track !== runTrack())) rival = null;
    if (knifeChanged) (OWN_MODELS ? loadOwnKnife : loadKnife)(next.knife);
    else if (finishChanged) applyFinish();
    if (!mapChanged) return;
    const known = maps.find((m) => m.id === next.map);
    if (known) (useMap(known), announceMap(), refreshRecords());
    else if (next.map.startsWith('bsp:')) loadFolderMap(next.map.slice(4));
    else (useMap(maps[0]), announceMap(), refreshRecords());
  },
  onShareCopy: async () => {
    const r = records[recordKey(runTrack(), map.id)];
    if (!r || !ghost) return hud.setShareNote('Set a record on this map first.');
    const code = await encodeShare({ map: map.id, track: runTrack(), name: player(), time: r.best, ghost });
    try {
      await navigator.clipboard.writeText(code);
      hud.setShareNote(`Code copied (${Math.ceil(code.length / 1000)} KB of text). Send it to a friend.`);
    } catch {
      hud.setShareNote('Your browser blocked copying.');
    }
  },
  onShareLoad: async (code: string) => {
    const s = await decodeShare(code);
    if (!s) return hud.setShareNote("That isn't a valid code.");
    const target = maps.find((m) => m.id === s.map);
    if (!target) return hud.setShareNote(`That run is on a map you don't have: ${s.map.replace(/^bsp:/, '')}`);
    if (s.map !== map.id) hud.apply({ map: s.map });
    rival = s;
    hud.setShareNote(`Racing ${s.name}: ${formatTime(s.time)} on ${target.name}. The orange ghost is theirs.`);
  },
  onReplay: () => startReplay(),
  onLoadFile: async (file: File) => {
    showLoading(file.name, 'Reading map file…', 0.3);
    return loadBsp(() => file.arrayBuffer(), file.name);
  },
});

// Chat and records: CS server-style lines for map changes and finishes.
const gameName = () => gameLabel(settings.game);
const mapShort = (m: MapDef) => (licensedMaps as { file: string; name: string }[]).find((l) => `bsp:${l.file}` === m.id)?.name ?? (m.id.startsWith('bsp:') ? m.id.slice(4).replace(/\.bsp$/i, '') : m.name);
const player = () => settings.name.trim() || 'Player';
const signed = (d: number) => `${d < 0 ? '-' : '+'}${formatTime(Math.abs(d))}`;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
function announceMap() {
  const pb = best();
  hud.chat([{ text: '[Surf] ', tone: 'tag' }, { text: `Now on ${mapShort(map)} with ${gameName()} movement. ` }, pb === null ? { text: 'No record here yet: leave the start zone to begin.' } : { text: `Your best: ${formatTime(pb)}`, tone: 'good' }]);
}
const nextMap = () => maps[maps.findIndex((m) => m.id === map.id) + 1] ?? null;
function showFinish(title: string, detail: string, tone: 'good' | 'bad') {
  finishShown = true;
  hud.showFinish({ title, time: formatTime(run.time), detail, speed: Math.round(maxSpeed), tone, next: nextMap()?.name ?? null });
}
function announceFinish(r: FinishResult) {
  const t = `${formatTime(run.time)} (max ${Math.round(maxSpeed)} u/s)`, head = [{ text: '[Surf] ', tone: 'tag' as const }, { text: player(), tone: 'name' as const }];
  if (r.kind === 'first') {
    hud.chat([...head, { text: ` finished ${mapShort(map)} in ${t}. ` }, { text: 'First record on this map!', tone: 'good' }]);
  } else if (r.kind === 'pb') {
    hud.chat([...head, { text: ` broke their record on ${mapShort(map)}: ${t} ` }, { text: `(${signed(r.delta)})`, tone: 'good' }]);
  } else {
    const nth = r.record.recent.length >= 3 ? `, your ${ordinal(r.rank)} best of the last ${r.record.recent.length}` : '';
    hud.chat([...head, { text: ` finished ${mapShort(map)} in ${t} ` }, { text: `(${signed(r.delta)}${nth})`, tone: 'bad' }]);
  }
}
const surf = (...parts: { text: string; tone?: 'good' | 'bad' }[]) => hud.chat([{ text: '[Surf] ', tone: 'tag' }, ...parts]);

// Checkpoints (surf servers' saveloc): position, view and speed. Teleporting to one makes the run practice.
const checkpoints: { pos: Player['pos']; vel: Player['vel']; yaw: number; pitch: number; ducked: boolean }[] = [];
let checkpointCount = 0;
let checkpointBack = 0; // how far key 3 has stepped back
function saveCheckpoint() {
  checkpointBack = 0;
  checkpoints.push({ pos: { ...cur.pos }, vel: { ...cur.vel }, ...input.view(), ducked: cur.ducked });
  if (checkpoints.length > 10) checkpoints.shift();
  surf({ text: `Checkpoint ${++checkpointCount} saved. Press 2 (or !tele) to go back to it.` });
}
function teleportCheckpoint(back = 0) {
  checkpointBack = back;
  const c = checkpoints.at(-1 - back);
  if (!c) return surf({ text: 'No checkpoint yet: press 1 (or !cp) to save one.', tone: 'bad' });
  prev = cur = { ...newPlayer(c.pos), vel: { ...c.vel }, ducked: c.ducked };
  simState = newTickState();
  input.setView(c.yaw, c.pitch);
  lastTickYaw = c.yaw;
  if (!practice && run.phase === 'running') surf({ text: "Practice mode: this run won't count as a record. Go back to the start (R) for a real run.", tone: 'bad' });
  practice = true;
  surf({ text: `Checkpoint ${checkpoints.length - back} of ${checkpoints.length} at ${Math.round(Math.hypot(c.vel.x, c.vel.y))} u/s` });
}

// Chat: Y opens the say line. "!command" shows in chat and runs; "/command" runs silently, as on CS servers.
function openChat() {
  typing = true;
  held.clear();
  input.setTyping(true);
  hud.openSay(onSay, () => {
    typing = false;
    input.setTyping(false);
  });
}
function onSay(text: string) {
  const command = /^[!/]./.test(text) ? text.slice(1).trim().split(/\s+/) : null;
  if (!command || text[0] === '!') hud.chat([{ text: player(), tone: 'name' }, { text: ` :  ${text}` }]);
  if (command) runCommand(command[0].toLowerCase(), command.slice(1));
}
function runCommand(name: string, args: string[]) {
  switch (name) {
    case 'r': case 'restart': case 'start':
      respawn();
      return surf({ text: 'Back to the start.' });
    case 'pb': case 'best': {
      const pb = best();
      return surf(pb === null ? { text: `No record on ${mapShort(map)} yet in ${gameName()}.` } : { text: `Your best on ${mapShort(map)} (${gameName()}): ${formatTime(pb)}`, tone: 'good' });
    }
    case 'cp': case 'save': case 'saveloc':
      return saveCheckpoint();
    case 'tele': case 'tp': case 'teleport':
      return teleportCheckpoint();
    case 'ghost':
      hud.apply({ showGhost: !settings.showGhost });
      return surf({ text: settings.showGhost ? (ghost ? 'Ghost on: race your best run.' : 'Ghost on. Set a record here and it will race you next time.') : 'Ghost off.' });
    case 'game': {
      const g = parseGame(args[0] ?? '');
      if (!g) return surf({ text: `Usage: !game ${HOSTED ? 'modern or !game classic' : 'cs16 or !game csgo'}`, tone: 'bad' });
      return hud.apply({ game: g });
    }
    case 'map': case 'nominate': {
      const id = args[0] ? hud.findMap(args.join(' ')) : null;
      if (!id) return surf({ text: args[0] ? `No map matching "${args.join(' ')}". Open the menu (Esc) to see them all.` : 'Usage: !map <name>, e.g. !map beginner', tone: 'bad' });
      return hud.apply({ map: id });
    }
    case 'setgoal':
      return setGoal(surfLine);
    case 'help': case 'commands':
      surf({ text: 'Commands: !r restart, !pb your best, !cp save a checkpoint, !tele go back to it (practice),' });
      return surf({ text: `!ghost on or off, !map <name> change map, !game ${HOSTED ? 'modern or classic' : 'cs16 or csgo'}, !setgoal mark the finish.` });
    default:
      return surf({ text: `Unknown command !${name}. Type !help for the list.`, tone: 'bad' });
  }
}

// ---------- Friends' leaderboard ----------
const board = createLeaderboard(import.meta.env.VITE_LEADERBOARD_URL);
let account = loadAccount();
const forgetAccount = () => (saveAccount((account = null)), hud.setBoardAccount(settings.groupCode ? '' : null));
// Only maps every friend has: not local or dropped-in ones.
const onBoards = (id: string) => builtins.some((m) => m.id === id) || (id.startsWith('bsp:') && licensedUrl(id.slice(4)) !== undefined);
const NEEDS_NAME = 'needs a name';
const accountTrouble = (e: unknown) =>
  e instanceof Error && e.message === NAME_TAKEN ? `The name "${player()}" is taken. Change your name on the Map tab, then press Join.`
  : e instanceof Error && e.message === NEEDS_NAME ? 'Pick your name on the Map tab, then press Join.'
  : null;
// The first time on the boards: claims this player's name.
async function ensureAccount(code: string) {
  if (account) return account;
  if (player() === defaults.name) throw new Error(NEEDS_NAME);
  account = await board!.register(code, player());
  saveAccount(account);
  hud.setBoardAccount(account.name);
  return account;
}
// Carries a changed name over to the boards. Says so if someone else has that name.
async function syncName(code: string) {
  if (!account || account.name === player() || player() === defaults.name) return null;
  const { token, name } = account;
  try {
    account = { token, name: (await board!.rename(code, token, player())).name };
    saveAccount(account);
    return null;
  } catch (e) {
    if (e instanceof Error && e.message === BAD_TOKEN) return forgetAccount(), null;
    return e instanceof Error && e.message === NAME_TAKEN ? `The name "${player()}" is taken, so you're still "${name}" on the boards.` : null;
  }
}
let boardAsked = 0;
async function showBoard(mapId = boardMap) {
  if (!board) return;
  const list = hud.mapList().filter((m) => onBoards(m.id));
  boardMap = onBoards(mapId) ? mapId : onBoards(map.id) ? map.id : list[0].id;
  const shown = boardMap, track = runTrack(), asked = ++boardAsked, def = builtins.find((m) => m.id === shown);
  const put = (rows: { place: number; name: string; time: number; mine: boolean; medal: string | null }[], note: string) =>
    hud.setBoard({ title: `Leaderboard: ${gameName()}${track === 'csgo128' ? ' 128-tick' : ''}`, maps: list, map: shown, rows, note });
  if (!settings.groupCode) return hud.setBoardAccount(null), put([], "Enter your group's code to see each other's times.");
  hud.setBoardAccount(account?.name ?? '');
  put([], 'Loading…');
  try {
    const nameTrouble = await syncName(settings.groupCode);
    hud.setBoardAccount(account?.name ?? '');
    const rows = await board.top(settings.groupCode, account?.token ?? null, track, shown);
    const open = maps.find((m) => m.id === shown);
    if (asked === boardAsked) put(rows.map((r) => ({ ...r, medal: def ? medalFor(def, r.time) : null })), nameTrouble ?? (rows.length ? '' : open && !sharedFinish(open) ? "This map has no finish everyone shares, so its times stay on each player's PC." : 'No times on this map yet.'));
  } catch (e) {
    if (asked !== boardAsked) return;
    put([], e instanceof Error && e.message === WRONG_CODE ? "That group code doesn't work any more. Ask for the new one." : "The leaderboard can't be reached right now. Your times still save here.");
  }
}
// Sends every best on this PC, so runs from before joining, or while offline, reach the boards too.
// Says what went wrong with the player's name, if anything.
async function syncBoards(): Promise<string | null> {
  if (!board || !settings.groupCode) return null;
  const code = settings.groupCode;
  let trouble: string | null = null;
  try {
    const { token } = await ensureAccount(code);
    trouble = await syncName(code);
    for (const [key, r] of Object.entries(records)) {
      const at = key.indexOf(':'), track = key.slice(0, at) as Track, id = key.slice(at + 1);
      if (onBoards(id) && !loadGoal(id)) await board.submit(code, token, track, id, r.best); // a saved goal: these times may be to a personal finish
    }
  } catch (e) {
    if (e instanceof Error && e.message === BAD_TOKEN) forgetAccount();
    trouble = accountTrouble(e); // anything else is tried again next time the game opens
  }
  return trouble;
}
async function joinGroup(typed: string) {
  if (!board) return;
  const code = typed.trim();
  if (code) {
    try {
      await board.top(code, null, runTrack(), onBoards(map.id) ? map.id : builtins[0].id);
    } catch (e) {
      const wrong = e instanceof Error && e.message === WRONG_CODE;
      return hud.setBoardNote(wrong ? "That isn't the group's code." : "The leaderboard can't be reached right now. Try again in a moment.");
    }
  }
  hud.apply({ groupCode: code });
  const trouble = await syncBoards();
  await showBoard();
  if (trouble) hud.setBoardNote(trouble);
}
// Moving to another PC: the code from the old one brings the same player and name back.
async function useRecovery(typed: string) {
  if (!board) return;
  const token = typed.trim();
  if (!settings.groupCode) return hud.setBoardNote("Enter your group's code first.");
  try {
    const { name } = await board.me(settings.groupCode, token);
    account = { name, token };
    saveAccount(account);
    hud.apply({ name });
    hud.clearRecoveryInput();
  } catch (e) {
    const bad = e instanceof Error && e.message === BAD_TOKEN;
    return hud.setBoardNote(bad ? "That recovery code isn't right." : "The leaderboard can't be reached right now. Try again in a moment.");
  }
  await syncBoards();
  await showBoard();
  hud.setBoardNote(`Welcome back, ${account.name}.`);
}
function copyRecovery() {
  if (!account) return;
  const token = account.token;
  navigator.clipboard.writeText(token).then(
    () => hud.setBoardNote('Recovery code copied. Keep it private: it brings your name and times to another PC, and it can\'t be sent again if lost.'),
    () => hud.setBoardNote(`Your recovery code, keep it private: ${token}`),
  );
}
let finishNo = 0;
// After a saved run: your best goes up (the service keeps the faster), and the finish screen shows where you stand.
async function postBest(best: number, time: number) {
  if (!board || !settings.groupCode || !onBoards(map.id)) return;
  const asked = ++finishNo, track = runTrack(), id = map.id, code = settings.groupCode;
  const say = (text: string) => void (asked === finishNo && finishShown && hud.setFinishBoard(text));
  if (!sharedFinish(map)) return say('Saved on this PC only: this map has no finish everyone shares.');
  if (loadGoal(id)) best = time; // older times here may be to a personal finish
  try {
    const { token } = await ensureAccount(code);
    await board.submit(code, token, track, id, best);
    const mine = (await board.top(code, token, track, id)).find((r) => r.mine);
    if (mine) say(`Leaderboard: #${mine.place} of ${mine.players}`);
  } catch (e) {
    if (e instanceof Error && e.message === BAD_TOKEN) forgetAccount();
    say(accountTrouble(e) ? 'Not on the leaderboard yet: check your name on the Map tab, then press Join on the Records tab.' : "Leaderboard not reached: it'll be sent next time.");
  }
}

// ---------- Developer console (`) ----------
const con = createConsole();
const conPrint: Print = (t, tone) => hud.consolePrint(t, tone);
let consoleFromGame = false, consoleShown = false;
function openConsole() {
  if (hud.consoleOpen()) return;
  consoleFromGame = input.locked();
  typing = true;
  input.setTyping(true);
  held.clear();
  input.cancelLock();
  if (consoleFromGame) document.exitPointerLock(); // the mouse is for the console now, like CS's
  if (!consoleShown) (consoleShown = true), con.execute('help', conPrint); // the first time: everything it knows
  hud.openConsole((line) => con.execute(line, conPrint), con.complete, () => {
    typing = false;
    input.setTyping(false);
    if (consoleFromGame) input.requestLock(); // closed with a key press: back into the game
  });
}
const bool = (v: string) => (v === '1' || v.toLowerCase() === 'true' ? true : v === '0' || v.toLowerCase() === 'false' ? false : null);
const num = (lo: number, hi: number, apply: (n: number) => void) => (v: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) return `expects a number from ${lo} to ${hi}`;
  apply(n);
};
function reloadMap() {
  if (map.id.startsWith('bsp:')) return void loadFolderMap(map.id.slice(4));
  useMap(map);
  announceMap();
}
function changeMap(query: string, print: Print) {
  const id = query ? hud.findMap(query) : null;
  if (!id) return print(query ? `map: no map matching "${query}" (maps lists them)` : 'Usage: map <name>', 'error');
  if (id === map.id) return reloadMap();
  hud.apply({ map: id });
}

con.command('kill', 'Respawn at the start', () => respawn());
con.command('explode', 'Respawn at the start', () => respawn());
con.command('restart', 'Restart your run', () => respawn());
con.command('mp_restartgame', 'Restart your run', () => respawn());
con.command('retry', 'Reload the map', () => reloadMap());
con.command('reconnect', 'Reload the map', () => reloadMap());
con.command('map', 'Change map: map <name>', (a, p) => changeMap(a.join(' '), p));
con.command('changelevel', 'Change map', (a, p) => changeMap(a.join(' '), p));
con.command('maps', 'List maps', (a, p) => hud.mapList().filter((m) => m.name.toLowerCase().includes((a[0] ?? '').toLowerCase())).forEach((m) => p(m.name)));
con.command('status', 'Map, game and your run', (_, p) => {
  p(`map     : ${mapShort(map)}`);
  p(`game    : ${gameName()} (${settings.game === 'cs16' ? '100 fps' : `${config.tickrate} tick`})`);
  p(`player  : ${player()}`);
  p(`run     : ${run.phase === 'ready' ? 'in the start zone' : formatTime(run.time) + (run.phase === 'finished' ? ' (finished)' : '')}${practice ? ', practice' : ''}`);
  const pb = best();
  p(`best    : ${pb === null ? 'none yet' : formatTime(pb)}`);
  if (map.stages) p(`stage   : ${stageNow + 1} of ${map.stages.length}`);
});
con.command('noclip', 'Fly through walls', (_, p) => {
  noclip = !noclip;
  if (!noclip) (prev = cur = { ...cur, vel: vec() }), (simState = newTickState());
  p(`noclip ${noclip ? 'ON' : 'OFF'}`);
});
con.command('setgoal', 'Set the finish here (maps without one)', (_, p) => setGoal(p));
con.command('saveloc', 'Save a checkpoint', () => saveCheckpoint());
con.command('teleport', 'Go to your checkpoint', () => teleportCheckpoint());
con.command('say', 'Chat: say <text>', (a) => a.length && onSay(a.join(' ')));
con.command('clear', 'Clear the console', () => hud.consoleClear());
con.command('toggleconsole', 'Open or close the console', () => (hud.consoleOpen() ? hud.closeConsole() : openConsole()));
con.command('sv_defaults', 'Reset all sv_ settings', (_, p) => {
  if (run.phase === 'running' && serverChanged()) practice = true;
  for (const k of SERVER_KEYS) (config as Record<string, unknown>)[k] = modeDefault(settings.game, k);
  p(`Server settings restored to ${gameName()} defaults.`);
});

// Server cvars: the movement rules. Off-default values mark runs as practice (they're not comparable).
const SERVER = { sv_airaccelerate: 'airaccelerate', sv_accelerate: 'accelerate', sv_friction: 'friction', sv_stopspeed: 'stopspeed', sv_gravity: 'gravity', sv_maxspeed: 'maxspeed', sv_maxvelocity: 'maxvelocity' } as const;
const SERVER_KEYS = Object.values(SERVER);
const serverChanged = () => SERVER_KEYS.some((k) => config[k] !== modeDefault(settings.game, k));
const SERVER_HELP: Record<string, string> = { sv_airaccelerate: 'Air acceleration', sv_accelerate: 'Ground acceleration', sv_friction: 'Ground friction', sv_stopspeed: 'Friction stop speed', sv_gravity: 'Gravity', sv_maxspeed: 'Top running speed', sv_maxvelocity: 'Speed cap per axis' };
for (const [name, key] of Object.entries(SERVER))
  con.cvar(name, SERVER_HELP[name], {
    get: () => String(+config[key].toFixed(3)),
    def: () => String(modeDefault(settings.game, key)),
    set: num(0, 100000, (n) => {
      config[key] = n;
      if (run.phase === 'running') practice = true; // restoring it before the finish doesn't clean the run
      if (serverChanged()) conPrint("Server settings now differ from the defaults: runs won't be saved as records (sv_defaults restores them).", 'dim');
    }),
  });
con.cvar('sv_autobunnyhopping', 'Auto bunnyhop (0/1)', {
  get: () => (settings.autobhop ? '1' : '0'),
  def: () => '1',
  set: (v) => (bool(v) === null ? 'expects 0 or 1' : void hud.apply({ autobhop: bool(v)! })),
});
con.cvar('sensitivity', 'Mouse sensitivity', { get: () => String(settings.sensitivity), def: () => '2', set: num(0.01, 20, (n) => hud.apply({ sensitivity: n })) });
for (const name of ['fov_desired', 'default_fov']) con.cvar(name, 'Field of view', { get: () => String(settings.fov), def: () => '90', set: num(60, 130, (n) => hud.apply({ fov: n })) });
con.cvar('name', 'Your chat name', { get: () => settings.name, set: (v) => (v.trim() ? void hud.apply({ name: v.trim().slice(0, 31) }) : 'name cannot be empty') });
con.cvar('game', HOSTED ? 'modern or classic' : 'csgo or cs16', {
  get: () => (HOSTED ? gameLabel(settings.game).toLowerCase() : settings.game),
  def: () => (HOSTED ? 'modern' : 'csgo'),
  set: (v) => (parseGame(v) ? void hud.apply({ game: parseGame(v)! }) : `expects ${HOSTED ? 'modern or classic' : 'csgo or cs16'}`),
});
con.cvar('tickrate', `64 or 128 (${gameLabel('csgo')} only)`, {
  get: () => String(config.tickrate),
  def: () => (settings.game === 'cs16' ? '100' : '64'),
  set: (v) => (settings.game === 'cs16' ? `${gameLabel('cs16')} always runs at 100 fps` : v === '64' || v === '128' ? void hud.apply({ tickrate: v === '128' ? 128 : 64 }) : 'expects 64 or 128'),
});
con.cvar('cl_showfps', 'Show FPS (0/1)', { get: () => (showFps ? '1' : '0'), def: () => '0', set: (v) => (bool(v) === null ? 'expects 0 or 1' : void (showFps = bool(v)!)) });
con.cvar('m_rawinput', 'Raw mouse input (0/1)', { get: () => (settings.rawInput ? '1' : '0'), def: () => '1', set: (v) => (bool(v) === null ? 'expects 0 or 1' : void hud.apply({ rawInput: bool(v)! })) });
con.cvar('cl_showspeed', 'Show speed (0/1)', { get: () => (settings.showSpeed ? '1' : '0'), def: () => '1', set: (v) => (bool(v) === null ? 'expects 0 or 1' : void hud.apply({ showSpeed: bool(v)! })) });
con.cvar('r_drawviewmodel', 'Show arms and knife (0/1)', { get: () => (settings.showViewmodel ? '1' : '0'), def: () => '1', set: (v) => (bool(v) === null ? 'expects 0 or 1' : void hud.apply({ showViewmodel: bool(v)! })) });
con.cvar('cl_ghost', 'Ghost of your best (0/1)', { get: () => (settings.showGhost ? '1' : '0'), def: () => '1', set: (v) => (bool(v) === null ? 'expects 0 or 1' : void hud.apply({ showGhost: bool(v)! })) });

// Binds: CS key names → console commands, kept in this browser. "+jump" sets the jump key instead.
const BINDS = 'surf-binds';
let binds: Record<string, string> = {};
try {
  const b = JSON.parse(localStorage.getItem(BINDS) ?? '{}');
  if (b && typeof b === 'object') binds = Object.fromEntries(Object.entries(b).filter(([k, v]) => typeof v === 'string' && /^[\w'.,/\\[\]=-]{1,16}$/.test(k))) as Record<string, string>;
} catch {}
const saveBinds = () => {
  try {
    localStorage.setItem(BINDS, JSON.stringify(binds));
  } catch {}
};
function runBind(key: string) {
  if (binds[key]) con.execute(binds[key], conPrint);
}
// CS key name back to a KeyboardEvent.code (for +jump, which the movement input reads by code).
const KEY_CODES = [...'abcdefghijklmnopqrstuvwxyz'].map((c) => `Key${c.toUpperCase()}`).concat([...'0123456789'].map((d) => `Digit${d}`), Array.from({ length: 12 }, (_, i) => `F${i + 1}`), ['Space', 'Enter', 'Tab', 'Backspace', 'ShiftLeft', 'ControlLeft', 'AltLeft', 'CapsLock', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'], Array.from({ length: 10 }, (_, i) => `Numpad${i}`));
const codeFor = (key: string) => (key === 'mwheelup' ? 'WheelUp' : key === 'mwheeldown' ? 'WheelDown' : KEY_CODES.find((c) => keyName(c) === key) ?? null);
con.command('bind', 'bind <key> "<command>"', (a, p) => {
  const key = (a[0] ?? '').toLowerCase();
  if (!key) return p('Usage: bind <key> "<commands>", e.g. bind f "kill"', 'error');
  if (key === '`' || key === 'escape') return p(`${key} is reserved`, 'error');
  if (a.length === 1) return p(binds[key] ? `"${key}" = "${binds[key]}"` : `"${key}" is not bound`);
  const cmd = a.slice(1).join(' ');
  if (cmd === '+jump') {
    const code = codeFor(key);
    if (!code) return p(`Can't use "${key}" for jump`, 'error');
    hud.apply({ jumpBind: code });
    return p(`Jump is now on "${key}"`);
  }
  if (/^\+(attack|attack2|forward|back|moveleft|moveright|duck|speed|use|reload)$/.test(cmd)) return p(`${cmd} is built in (${cmd.startsWith('+attack') ? 'mouse buttons' : 'WASD, C, Shift'}); bind other commands to keys`, 'error');
  binds[key] = cmd;
  saveBinds();
});
con.command('unbind', 'unbind <key>', (a, p) => {
  const key = (a[0] ?? '').toLowerCase();
  if (!binds[key]) return p(`"${key}" is not bound`, 'dim');
  delete binds[key];
  saveBinds();
});
con.command('unbindall', 'Remove all binds', () => {
  binds = {};
  saveBinds();
});
con.command('bindlist', 'List your binds', (_, p) => {
  const keys = Object.keys(binds).sort();
  if (!keys.length) p('No bindings yet. Try: bind f "kill"', 'dim');
  keys.forEach((k) => p(`${k.padEnd(12)} "${binds[k]}"`));
});
conPrint('Type help for every command, or try: kill, retry, map, bind f "kill", sv_airaccelerate.', 'dim');

// Maps whose files mark no finish: the player marks it where they stand (saved per map).
function setGoal(print: Print) {
  if (!map.mesh) return print('Built-in maps have their own finish.', 'error');
  if ((map as { goalFromMap?: boolean }).goalFromMap) return print('This map has its own finish.', 'error');
  map.endZone = [goalBox(cur.pos)];
  saveGoal(map.id, cur.pos);
  hud.flash('Finish set here');
  print('Finish set here. Reach it to stop the timer.');
  if (licensed.some((l) => `bsp:${l.file}` === map.id)) print(`To make this the finish for everyone, add this to the map's entry in licensed-maps/manifest.json: "finish": [${Math.round(cur.pos.x)}, ${Math.round(cur.pos.y)}, ${Math.round(cur.pos.z)}]`);
}
const surfLine: Print = (text, tone) => surf({ text, tone: tone === 'error' ? 'bad' : undefined });

function refreshRecords() {
  const prefix = `${runTrack()}:`;
  const rows = Object.entries(records)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, r]) => {
      const m = maps.find((x) => x.id === k.slice(prefix.length));
      return { mapId: k.slice(prefix.length), best: r.best, finishes: r.finishes, bestAt: r.bestAt, medal: m ? medalFor(m, r.best) : null };
    })
    .sort((a, b) => b.bestAt - a.bestAt);
  hud.setRecords(`${gameName()}${runTrack() === 'csgo128' ? ' 128-tick' : ''}`, rows, map.id, records[recordKey(runTrack(), map.id)]?.recent ?? []);
}
refreshRecords();
if (!wantedMap.startsWith('bsp:')) announceMap(); // folder maps announce once they've loaded

// Loading dialog steps; yields a frame between heavy steps so the bar actually paints.
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const showLoading = (mapName: string, step: string, fraction: number) =>
  hud.loading({ game: gameTitle(settings.game), map: mapName.replace(/\.bsp$/i, ''), step, fraction });
async function download(url: string, onProgress: (f: number) => void): Promise<Response & { bytes: ArrayBuffer }> {
  const res = await fetch(url);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.ok || !res.body || !total) return Object.assign(res, { bytes: res.ok ? await res.arrayBuffer() : new ArrayBuffer(0) });
  const reader = res.body.getReader(), parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onProgress(Math.min(1, got / total));
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const p of parts) bytes.set(p, at), (at += p.length);
  return Object.assign(res, { bytes: bytes.buffer });
}

// stock: stock CS:GO files bundled by import-maps for this map; the map's own packed files win.
async function loadBsp(read: () => Promise<ArrayBuffer>, name: string, stock?: Map<string, Uint8Array>) {
  hud.setStatus(`Loading ${name}…`);
  try {
    const bytes = await read();
    showLoading(name, 'Parsing map resources…', 0.7);
    await nextFrame();
    const bsp = parseBsp(bytes, name);
    for (const [k, v] of stock ?? []) if (!bsp.pak.has(k)) bsp.pak.set(k, v);
    const m = bspToMap(bsp, name, licensed.find((l) => l.file === name)?.finish);
    const i = maps.findIndex((x) => x.id === m.id);
    if (i >= 0) maps[i] = m;
    else maps.push(m);
    hud.addMap(m);
    settings = { ...settings, map: m.id };
    saveSettings(settings);
    showLoading(name, 'Precaching textures and models…', 0.85);
    await nextFrame();
    const tex = useMap(m);
    showLoading(name, 'Entering the game…', 1);
    await nextFrame();
    announceMap();
    refreshRecords();
    const goal = m.goalFromMap ? 'goal found in map' : m.endZone ? 'using your saved goal' : 'no finish in map: type setgoal in the console (or !setgoal in chat) at the finish';
    // Texture report so a missing-texture problem shows what happened (decode path, GPU support).
    const texNote = tex ? ` Textures: ${tex.gpu + tex.cpu} loaded${tex.cpu ? ` (${tex.cpu} decoded on CPU: no GPU texture compression)` : ''}, ${tex.missing} missing${tex.missing && !stock && !HOSTED ? (USING_REAL ? ' (install the csgo_legacy beta of CS2 in Steam, then Import again, for the exact textures)' : ' (stock CS:GO: run npm run import-maps with CS:GO legacy installed)') : ''}.` : '';
    hud.setStatus(`Loaded ${m.brushes.length} brushes, ${m.teleports.length} teleports, ${m.pushes.length} boosters; ${goal}.${texNote}`);
  } catch (e) {
    hud.setStatus(e instanceof Error ? e.message : String(e), true);
    hud.chat([{ text: '[Surf] ', tone: 'tag' }, { text: `Couldn't load ${name}: ${e instanceof Error ? e.message : e}`, tone: 'bad' }]);
  } finally {
    hud.loading(null);
  }
}

// Maps folder (public/maps, filled by `npm run import-maps`), served by the dev server.
async function loadFolderMap(file: string) {
  const permitted = licensedUrl(file);
  if (permitted) {
    return loadBsp(async () => {
      const res = await download(permitted, (f) => showLoading(file, 'Downloading map…', f * 0.65));
      if (!res.ok) throw new Error(`${file} couldn't be downloaded`);
      return res.bytes;
    }, file);
  }
  showLoading(file, 'Retrieving stock textures…', 0);
  const zip = await download(assetUrl(`/maps/${encodeURIComponent(file.replace(/.bsp$/i, '.stock.zip'))}`), (f) => showLoading(file, 'Retrieving stock textures…', f * 0.2)).catch(() => null);
  // The dev server answers unknown paths with its HTML page, which reads as an empty zip: treat that as no bundle.
  const files = zip?.ok ? readZip(new Uint8Array(zip.bytes)) : new Map<string, Uint8Array>();
  const stock = files.size ? files : undefined;
  return loadBsp(
    async () => {
      const res = await download(assetUrl(`/maps/${encodeURIComponent(file)}`), (f) => showLoading(file, 'Downloading map…', 0.2 + f * 0.45));
      if (!res.ok) throw new Error(`${file} isn't in the maps folder anymore`);
      return res.bytes;
    },
    file,
    stock,
  );
}

// CS2's arms and knives, decoded by `npm run import-maps` from the local CS2 install (absent → no viewmodel).
const json = (url: string) => fetch(assetUrl(url)).then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null));
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Any = any;
let knives: { id: string; name: string; finishes: string[] }[] = [];
const finishNames: Record<string, string> = {};
type TrackJson = { frames: number; duration: number; poses: string };
const cs2 = () => import('./cs2model');
const track = (c: TrackJson) => ({ ...c, poses: new Float32Array(unb64(c.poses).buffer) });
function loadKnife(id: string) {
  Promise.all([json(`/cs2/knives/${id}.json`), cs2()])
    .then(([j, { meshFromJson, vtexFromJson }]) => {
      if (!j || settings.knife !== id) return; // a newer pick won the race
      const clips = Object.fromEntries(Object.entries(j.clips as Record<string, TrackJson & { knife: TrackJson | null }>).map(([k, c]) => [k, { ...track(c), knife: c.knife && track(c.knife) }]));
      const p = j.paint;
      const paint = p && { ...p, masks: vtexFromJson(p.masks), ao: vtexFromJson(p.ao), pos: vtexFromJson(p.pos) };
      renderer.setKnife({ mesh: meshFromJson(j.mesh), skeleton: j.skeleton, clips: clips as Parameters<typeof renderer.setKnife>[0]['clips'], paint });
      hud.setFinishes((knives.find((k) => k.id === id)?.finishes ?? []).map((f) => ({ id: f, name: finishNames[f] ?? f })));
      applyFinish();
    })
    .catch((e) => console.warn('knife:', e));
}
// Finishes load on demand: each is a few MB (its pattern), the shared wear/grunge set once.
const finishCache = new Map<string, Promise<unknown>>();
const cached = (url: string, decode: (j: Any) => unknown) => {
  if (!finishCache.has(url)) finishCache.set(url, json(url).then((j) => j && decode(j)));
  return finishCache.get(url)!;
};
function applyFinish() {
  const want = settings.finish, offered = knives.find((k) => k.id === settings.knife)?.finishes ?? [];
  if (!want || !offered.includes(want)) return void renderer.setFinish(null);
  Promise.all([
    cached(`/cs2/finishes/${want}.json`, async (j) => ({ ...j, pattern: j.pattern && (await cs2()).vtexFromJson(j.pattern) })),
    cached('/cs2/finishes/shared.json', async (j) => { const { vtexFromJson } = await cs2(); return { wear: j.wear && vtexFromJson(j.wear as VtexJson), grunge: j.grunge && vtexFromJson(j.grunge as VtexJson) }; }),
  ])
    .then(([finish, shared]) => {
      if (settings.finish !== want || !finish || !shared) return; // a newer pick won the race, or the file is gone
      if (!renderer.setFinish({ finish, shared, wear: settings.wear, seed: settings.seed } as Parameters<typeof renderer.setFinish>[0])) hud.flash('This finish needs BC7 texture support (not available in this browser)');
    })
    .catch((e) => console.warn('finish:', e));
}
// CS 1.6's knife and hands (v_knife.mdl from your Counter-Strike install, copied by the import).
renderer.setGame(settings.game);
renderer.setShowViewmodel(settings.showViewmodel);
const gltf = new GLTFLoader();
// The game's own knives, each loaded when picked (its file carries the arms too).
const OWN_KNIVES = [{ id: 'knife_karambit', name: 'Karambit', url: karambitModel }, { id: 'knife_m9', name: 'M9 Bayonet', url: m9Model }];
const ownKnifeLoads = new Map<string, Promise<GLTF>>(); // each knife is loaded once and kept, so switching back costs nothing
function loadOwnKnife(id: string) {
  const k = OWN_KNIVES.find((x) => x.id === id) ?? OWN_KNIVES[0];
  if (!ownKnifeLoads.has(k.id)) {
    hud.flash(`Loading ${k.name}…`);
    ownKnifeLoads.set(k.id, gltf.loadAsync(k.url));
  }
  ownKnifeLoads.get(k.id)!.then((g) => {
    if (OWN_MODELS && (OWN_KNIVES.find((x) => x.id === settings.knife) ?? OWN_KNIVES[0]) !== k) return; // a newer pick won the race
    renderer.setOwn('csgo', g.scene, g.animations);
  }).catch((e) => {
    ownKnifeLoads.delete(k.id); // let a later pick try again
    console.warn('viewmodel:', e);
  });
}
if (OWN_MODELS) {
  hud.setKnives(OWN_KNIVES);
  loadOwnKnife(settings.knife);
} else loadOwnKnife(OWN_KNIVES[0].id); // shown until the imported CS2 knife arrives
// Classic's models, the first time that mode is played.
let classicLoad: Promise<GLTF> | null = null;
function loadClassic() {
  classicLoad ??= gltf.loadAsync(retroModel);
  classicLoad.then((g) => renderer.setOwn('cs16', g.scene, g.animations)).catch((e) => {
    classicLoad = null;
    console.warn('viewmodel:', e);
  });
}
if (settings.game === 'cs16') loadClassic();
// Maps used with permission (licensed-maps/), in every build.
for (const m of licensed) {
  hud.addLicensedMap({ id: `bsp:${m.file}`, name: m.name, difficulty: m.difficulty, source: m.source, credit: `by ${m.author}. ${m.permission}.` });
}
if (wantedMap.startsWith('bsp:') && licensedUrl(wantedMap.slice(4))) loadFolderMap(wantedMap.slice(4));
// The public build has none of these files, so it doesn't ask for them.
if (!OWN_MODELS) {
fetch(assetUrl('/cs16/v_knife.mdl'))
  .then((r) => (r.ok && !r.headers.get('content-type')?.includes('html') ? r.arrayBuffer() : null))
  .then(async (b) => b && renderer.setKnife16((await import('./goldsrcmdl')).parseMdl(b)))
  .catch((e) => console.warn('CS 1.6 knife:', e));
json('/cs2/viewmodel.json')
  .then(async (j) => j && renderer.setArms({ skeleton: j.skeleton, arms: (await cs2()).meshFromJson(j.arms) }))
  .catch((e) => console.warn('viewmodel arms:', e));
json('/cs2/finishes/index.json')
  .then((names) => names && Object.assign(finishNames, names))
  .catch(() => {})
  .then(() => json('/cs2/knives/index.json'))
  .then((list: typeof knives | null) => {
    if (!list?.length) return;
    knives = list;
    hud.setKnives(list);
    if (!list.some((k) => k.id === settings.knife)) settings = { ...settings, knife: list[0].id };
    loadKnife(settings.knife);
  })
  .catch(() => {});

fetch(assetUrl('/maps/index.json'))
  .then((r) => (r.ok ? r.json() : []))
  .then((files: string[]) => {
    for (const f of files) hud.addMap({ id: `bsp:${f}`, name: `CS:GO: ${f.replace(/\.bsp$/i, '')}` }, false);
    if (wantedMap.startsWith('bsp:') && files.includes(wantedMap.slice(4))) loadFolderMap(wantedMap.slice(4));
  })
  .catch(() => {}); // no dev server endpoint: built-in maps and file loading still work
}

// Desktop app only: real models, knives, skins and maps from the player's own CS install.
type GameFolders = { csgo: string | null; halfLife: string | null };
const gameFolders = (): Promise<GameFolders> => fetch(`${STEAM}/info`).then((r) => r.json());
function importRealModels() {
  const fail = (why: string) => {
    setUsingReal(USING_REAL); // a failed first import isn't retried on every launch; the button still can
    hud.loading(null);
    hud.setRealModels({ note: `Import failed: ${why}`, importLabel: 'Try again', canRemove: USING_REAL });
  };
  showImport('Looking for Counter-Strike…', 0);
  gameFolders().then((folders) => {
    const worker = new Worker(new URL('./steam-import.worker.ts', import.meta.url), { type: 'module' });
    let fraction = 0;
    worker.onerror = (e) => (worker.terminate(), fail(e.message));
    worker.onmessage = (e) => {
      const m = e.data as { line?: string; fraction?: number; done?: { knives: number; cs16: boolean; maps: number }; error?: string };
      fraction = m.fraction ?? fraction;
      if (m.line) showImport(m.line, fraction);
      if (m.error) return worker.terminate(), fail(m.error);
      if (!m.done) return;
      worker.terminate();
      if (!m.done.knives && !m.done.cs16) return fail('no usable Counter-Strike files were found.');
      setUsingReal(true);
      location.reload();
    };
    worker.postMessage(folders);
  }).catch((e) => fail(String(e)));
}
const showImport = (step: string, fraction: number) => hud.loading({ game: 'Real CS models', map: 'Reading your Counter-Strike files', step, fraction });
async function removeRealModels() {
  setUsingReal(false);
  await fetch(`${STEAM}/clear`, { method: 'POST' }).catch(() => {});
  location.reload();
}
// Updating replaces the app, not your records, settings or imported CS files.
function installUpdate() {
  hud.flash('Downloading the update. The game restarts when it\'s ready.');
  tauri?.core.invoke('install_update').catch(() => hud.flash("The update couldn't be installed. Try again later."));
}
if (DESKTOP) {
  tauri?.core.invoke('check_update').then((v) => v && hud.showUpdate(`Update to ${v}`)).catch(() => {}); // offline, or no release yet: nothing to offer
  gameFolders()
    .then((f) => {
      const found = [f.csgo && 'CS2/CS:GO', f.halfLife && 'CS 1.6'].filter(Boolean).join(' and ');
      if (USING_REAL) hud.setRealModels({ note: 'Using the knives, skins and maps from your own Counter-Strike. These files stay on this PC.', importLabel: 'Import again', canRemove: true });
      else if (found) {
        hud.setRealModels({ note: `Found ${found}. Importing uses the knives, skins and maps from your own copy, and takes about a minute. These files stay on this PC.`, importLabel: 'Import from my CS install', canRemove: false });
        if (REAL_UNDECIDED) importRealModels();
      }
      else hud.setRealModels({ note: 'No Counter-Strike found in Steam, so the game uses its built-in models.', importLabel: null, canRemove: false });
    })
    .catch(() => {});
}

syncBoards();
input.onLockRefused(() => !menuClosed && hud.flash('Your browser needs a moment. Click Play again.'));
input.setKeys(settings.keys);
input.setFullscreen(settings.fullscreen);
input.setRawInput(settings.rawInput);

// Watch your best run from behind. Any key ends it.
function startReplay() {
  if (!ghost) return hud.setShareNote('Set a record on this map first.');
  if (input.locked()) document.exitPointerLock();
  input.setTyping(true); // a click during the replay must not grab the mouse
  hud.showOverlay(false);
  hud.showStart(false);
  hud.showResume(false);
  if (finishShown) (hud.showFinish(null), (finishShown = false));
  renderer.setShowViewmodel(false);
  replayStart = performance.now();
  surf({ text: 'Replay: press any key to stop.' });
}
function stopReplay() {
  replayStart = -1;
  input.setTyping(false);
  renderer.setShowViewmodel(settings.showViewmodel);
  renderer.setGhost(null);
  hud.showOverlay(true);
}
// Esc closed the menu, but browsers don't hand the mouse back on Esc: the game waits for a click.
let menuClosed = false, lockLostAt = -1000;
const showMenu = (open: boolean) => {
  menuClosed = !open;
  if (open) input.cancelLock();
  hud.showOverlay(open);
  hud.showResume(!open);
};
const closeMenu = () => {
  if (hud.backToStart()) return;
  showMenu(false);
  input.requestLock(); // after Esc usually refused; then the hint asks for a click
};
input.onLockChange((locked) => {
  if (locked) (menuClosed = false), hud.showStart(false);
  if (!locked) lockLostAt = performance.now();
  hud.showOverlay(!locked && !menuClosed && !hud.consoleOpen()); // the console stands alone: closing it goes back to the game
  hud.showResume(!locked && menuClosed);
  acc.reset();
  held.clear();
});
window.addEventListener('keydown', (e) => {
  if (replayStart >= 0) {
    e.preventDefault();
    return stopReplay();
  }
  // The console's field handles its own keys, so this is only after a click took focus away from it.
  if (hud.consoleOpen() && (e.key === 'Escape' || e.code === 'Backquote' || e.key === '`')) return hud.closeConsole();
  // In game, Esc is the browser's own: it releases the mouse and the menu opens. Out of game it toggles the menu.
  if (e.key === 'Escape' && !typing && !e.repeat && !hud.startOpen()) {
    if (input.locked()) return document.exitPointerLock(); // fullscreen holds Esc for us, so this one is the game's
    if (performance.now() - lockLostAt < 300) return; // the same press that just freed the mouse: the menu stays open
    if (menuClosed) showMenu(true);
    else closeMenu();
    return;
  }
  if ((e.code === 'Backquote' || e.key === '`') && !typing && !e.repeat) { // the key under Esc, whatever the layout prints on it
    e.preventDefault();
    return openConsole();
  }
  if (!input.locked() || typing) return;
  if (!e.repeat) runBind(keyName(e.code));
  if (e.code === 'KeyY') {
    e.preventDefault(); // so the Y isn't typed into the chat line it opens
    return openChat();
  }
  if (e.code === 'Digit1') saveCheckpoint();
  if (e.code === 'Digit2') teleportCheckpoint();
  if (e.code === 'Digit3') teleportCheckpoint(Math.min(checkpointBack + 1, Math.max(0, checkpoints.length - 1)));
  if (e.code === 'KeyR') respawn();
  if (e.code === 'KeyN' && finishShown && nextMap()) hud.apply({ map: nextMap()!.id });
  if (e.code === 'KeyF') renderer.inspect(); // CS's inspect key
});
// Knife attacks: left click slashes, right click stabs; holding keeps attacking at CS's rate.
const held = new Set<number>();
window.addEventListener('mousedown', (e) => {
  if (!input.locked() || typing) return;
  if (e.button === 0 || e.button === 2) held.add(e.button);
  runBind(`mouse${[1, 3, 2, 4, 5][e.button] ?? e.button + 1}`); // browser buttons 0,1,2,3,4 → CS mouse1, mouse3, mouse2, mouse4, mouse5
});
window.addEventListener('wheel', (e) => input.locked() && !typing && runBind(e.deltaY > 0 ? 'mwheeldown' : 'mwheelup'));
window.addEventListener('mouseup', (e) => held.delete(e.button));
window.addEventListener('contextmenu', (e) => input.locked() && e.preventDefault());
window.addEventListener('resize', renderer.resize);
let last = performance.now();
document.addEventListener('visibilitychange', () => {
  acc.reset();
  last = performance.now();
});

const eye = (p: Player) => add(p.pos, vec(0, 0, p.ducked ? config.eyeDuck : config.eyeStand));

function tick(cmd: ReturnType<typeof input.cmd>, tickDt: number) {
  prev = cur;
  if (noclip) {
    // Noclip: fly where you look (jump up, crouch down) at CS's noclip speed, through everything.
    const { forward, right } = angleVectors(cmd.yaw, cmd.pitch);
    const dir = normalize(add(add(scale(forward, cmd.forward), scale(right, cmd.side)), vec(0, 0, (cmd.jump ? 1 : 0) - (cmd.duck ? 1 : 0))));
    cur = { ...cur, pos: add(cur.pos, scale(dir, config.maxspeed * 5 * (cmd.walk ? 0.52 : 1) * tickDt)), vel: vec(), onGround: false };
    practice = true;
  }
  const r = noclip ? null : simTick(map, grid, cur, cmd, tickDt, simState);
  if (r?.event === 'respawn') {
    // Past the first stage a fall costs time, not the whole run.
    const s = map.stages?.[stageNow];
    if (!s || stageNow === 0 || run.phase !== 'running' || r.reason === 'stuck') return respawn();
    prev = cur = newPlayer(s.spawn);
    simState = newTickState();
    input.setView(s.yaw, 0);
    lastTickYaw = s.yaw;
    hud.flash(`Back to stage ${stageNow + 1}`);
    return;
  }
  if (r) (cur = r.player), (simState = r.state);
  if (r?.teleport?.stage !== undefined && map.stages) {
    stageNow = r.teleport.stage;
    splits[stageNow - 1] = run.time;
    const was = records[recordKey(runTrack(), map.id)]?.splits?.[stageNow - 1];
    const vs = was === undefined ? '' : ` (${signed(run.time - was)})`;
    surf({ text: `Stage ${stageNow + 1} of ${map.stages.length} at ${formatTime(run.time)}${vs}`, tone: was === undefined ? undefined : run.time < was ? 'good' : 'bad' });
    hud.flash(`Stage ${stageNow + 1} of ${map.stages.length}${vs}`);
  }
  if (r?.teleport) {
    prev = cur;
    if (!r.teleport.keepAngles) {
      input.setView(r.teleport.yaw, input.view().pitch);
      lastTickYaw = r.teleport.yaw;
    }
  }
  const was = run.phase;
  run = tickRun(run, touching(cur, map.startZone), touching(cur, map.endZone), tickDt);
  const speed = Math.hypot(cur.vel.x, cur.vel.y);
  if (run.phase === 'ready') practice = false; // back in the start zone: a fresh, valid run (noclip sets it again each tick)
  if (run.phase !== 'ready' && was === 'ready') {
    // Left the start zone: what surf timers call start speed (prestrafe).
    recording = [];
    maxSpeed = 0;
    surf({ text: `Start speed: ${Math.round(speed)} u/s` });
  }
  if (run.phase !== 'ready' && was !== 'finished') {
    recording.push(cur.pos.x, cur.pos.y, cur.pos.z, lastTickYaw);
    maxSpeed = Math.max(maxSpeed, speed);
  }
  const finish = finishKind(was, run.phase, practice, serverChanged());
  if (finish) {
    if (finish !== 'record') {
      surf({ text: `Practice run: ${formatTime(run.time)}. ${finish === 'practice' ? 'Checkpoints, noclip or changed server settings were used' : 'Server settings differ from the defaults (sv_defaults restores them)'}, so it isn't saved.`, tone: 'bad' });
      showFinish('Practice run', finish === 'practice' ? 'Checkpoints, noclip or changed server settings were used, so it isn\'t saved' : 'Server settings differ from the defaults, so it isn\'t saved', 'bad');
    } else {
      const r = recordFinish(records, runTrack(), map.id, run.time, Date.now(), splits.slice());
      records = r.all;
      saveRecords(records);
      announceFinish(r);
      showFinish(r.kind === 'first' ? 'First record!' : r.kind === 'pb' ? 'New personal best!' : 'Finished', [r.kind === 'first' ? '' : `${signed(r.delta)} vs your best`, medalFor(map, run.time) ? `${medalFor(map, run.time)} medal` : '', rival ? `${signed(run.time - rival.time)} vs ${rival.name}` : ''].filter(Boolean).join('   '), r.kind === 'slower' ? 'bad' : 'good');
      refreshRecords();
      postBest(r.record.best, run.time);
      // A new best becomes the ghost you race next time.
      const g = r.kind !== 'slower' ? ghostFromTicks(recording, tickDt) : null;
      if (g) saveGhost(runTrack(), map.id, (ghost = g));
    }
  }
}

let fpsFrames = 0, fpsSince = performance.now();
function frame(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  fpsFrames++;
  if (now - fpsSince > 500) {
    hud.setFps(showFps ? (fpsFrames * 1000) / (now - fpsSince) : null);
    (fpsFrames = 0), (fpsSince = now);
  }
  // Pause while unlocked or hidden; the accumulator was reset on those transitions.
  if (input.locked() && !document.hidden) {
    if (typing) held.clear();
    if (held.has(0)) renderer.attack('light');
    else if (held.has(2)) renderer.attack('heavy');
    const ticks = acc.advance(dt);
    if (ticks) {
      const cmd = input.cmd();
      const tickDt = 1 / config.tickrate;
      const from = lastTickYaw;
      for (let i = 0; i < ticks; i++) {
        lastTickYaw = tickYaw(from, cmd.yaw, i, ticks);
        tick({ ...cmd, yaw: lastTickYaw }, tickDt);
      }
    }
  }
  // Interpolate the eye point itself so crouch height changes don't snap the camera.
  const a = eye(prev), b = eye(cur);
  const { yaw, pitch } = input.view();
  pose = stepPose(pose, { speed: Math.hypot(cur.vel.x, cur.vel.y), onGround: cur.onGround, yawDelta: yaw - lastFrameView.yaw, pitchDelta: pitch - lastFrameView.pitch }, Math.min(dt, 0.1));
  lastFrameView = { yaw, pitch };
  const speedNow = Math.hypot(cur.vel.x, cur.vel.y);
  fovKick += ((settings.speedFx ? Math.min(1, Math.max(0, (speedNow - 700) / 2300)) * 9 : 0) - fovKick) * Math.min(1, dt * 4);
  renderer.setFovKick(fovKick);
  if (replayStart >= 0 && ghost) {
    const t = (now - replayStart) / 1000, s = sampleGhost(ghost, t), f = angleVectors(s.yaw, 12).forward;
    renderer.draw(add(s.pos, add(scale(f, -150), vec(0, 0, 80))), s.yaw, 12, pose);
    hud.setSpeed(0);
    hud.setTimer(formatTime(Math.min(t, ghostSeconds(ghost))), '', false);
    renderer.setGhost(s.pos);
    renderer.setRival(null);
    if (t > ghostSeconds(ghost) + 1.5) stopReplay();
    requestAnimationFrame(frame);
    return;
  }
  renderer.draw(add(a, scale(sub(b, a), acc.alpha())), yaw, pitch, pose);
  hud.setSpeed(speedNow);
  const pb = best();
  hud.setTimer(formatTime(run.time), pb === null ? '' : `PB ${formatTime(pb)}`, practice);
  // The ghost waits at the start, runs alongside yours in time, and parks at the finish.
  const gt = run.phase === 'running' ? run.time + acc.alpha() / config.tickrate : run.phase === 'finished' ? run.time : 0;
  renderer.setGhost(settings.showGhost && ghost ? sampleGhost(ghost, gt).pos : null);
  renderer.setRival(rival ? sampleGhost(rival.ghost, gt).pos : null);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
