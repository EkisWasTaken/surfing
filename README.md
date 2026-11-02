# Surfing

A browser surf game that plays like Counter-Strike: real CS:GO and CS 1.6 movement, your own surf maps, and the CS2 knives and skins, all running in the browser with TypeScript and three.js.

No game files are included. The game reads maps, knives and textures from your own Steam installs through a local import step, and that output stays on your machine (git-ignored).

## Two versions

- **The hosted game** is what `npm run build` produces and what GitHub Pages serves. It's instantly playable from a link, with 6 original maps and nothing from Steam: no Valve models, skins or textures. Its arms and knife are licensed models (see Credits). The two movement modes are called Modern and Classic. Anyone can still open a `.bsp` they already have with "Load .bsp file"; it stays in their own browser.
- **The local version** (`npm run dev` after `npm run import-maps`) has everything below, read from your own Steam installs.

### Hosting it

Every push to `master` tests, builds and deploys through `.github/workflows/deploy.yml`. Turn it on once in the repo: **Settings → Pages → Source → GitHub Actions**. The game is then at `https://<username>.github.io/<repo>/`.

The build leaves out `public/`, where imported Steam files live, so `dist` is also safe to upload to any static host.

## Features (local version)

- **Two movement modes, switched with one setting.**
  - **CS:GO** is a port of Source's `CGameMovement`: airaccelerate 150 for surf, 64 or 128 tick, edge friction, and teleports that keep velocity.
  - **CS 1.6** uses GoldSrc rules: 100 fps, airaccelerate 100, jump stamina, the bunnyhop speed cap, and teleports that zero velocity.
- **Real surf maps.** It loads CS:GO `.bsp` files: brush geometry, lightmaps, packed and stock textures, skybox, fog, and static props. Map triggers work: `trigger_teleport` (with landmarks), `trigger_push`, `trigger_hurt`, and start and finish zones.
- **Knives from CS2.** All 22 knives come with arms, draw, idle, inspect and slash/stab animations, decoded from your CS2 install. Attacks and inspect cancel each other like in CS.
- **Skins.** 78 finishes, with wear and pattern seed you can tweak in the menu.
- **CS 1.6 knife.** In 1.6 mode the game uses the real `v_knife.mdl` from Counter-Strike.
- **Timer and records.** You get personal bests per map and game, a recent-runs table, and chat announcements for new records. Start speed and max speed are shown.
- **Ghost.** A ghost replays your best run so you can race it.
- **Checkpoints and practice mode.** Teleporting to a checkpoint marks the run as practice, so it isn't saved as a record.
- **Chat and console.** Chat (Y) takes `!` commands. The developer console (`` ` ``) has CS commands, `sv_` cvars, binds, autocorrect, and Tab completion.
- **Two menu themes.** The menu and HUD use either the CS 1.6 VGUI look or a CS:GO theme, following the game setting.

## Getting started

You need Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173. Six built-in maps work right away. For real maps, knives and skins, import them from your Steam installs:

```bash
npm run import-maps
```

By default it looks in `C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive/csgo/maps`. Pass your own path if Steam lives elsewhere:

```bash
npm run import-maps -- "D:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive/csgo/maps"
```

What it reads:

| Source | Gives you |
| --- | --- |
| `csgo/maps/surf_*.bsp` | The maps (copied to `public/maps`) |
| CS2 (`game/csgo/pak01_dir.vpk`) | Arms, knives, animations, finishes, and stock textures |
| CS:GO legacy beta (optional) | The exact stock textures; without it they are converted from CS2 |
| Counter-Strike 1.6 (`Half-Life/cstrike`) | The 1.6 knife |

Anything missing is skipped. For example, without CS 1.6 installed the 1.6 mode still works, just without its knife model. You can also load any `.bsp` from the Map tab without importing it.

## Controls

| Action | Key |
| --- | --- |
| Move | W A S D |
| Jump | Space (rebindable, including the mouse wheel) |
| Walk / crouch | Shift / C |
| Slash / stab | Left / right click |
| Inspect knife | F |
| Restart run | R |
| Save / go to checkpoint | 1 / 2 |
| Chat | Y |
| Console | `` ` `` (the key under Esc) |
| Menu | Esc |

## Chat commands

`!r` restart · `!pb` your best · `!cp` / `!tele` checkpoints · `!ghost` toggle the ghost · `!map <name>` change map · `!game cs16|csgo` switch game · `!setgoal` mark the finish · `!help`

## Console

Type `help` to list everything; it also prints the first time you open the console. A few highlights:

```
kill / restart        respawn at the start
retry                 reload the map
map <name>            change map (part of the name is enough)
noclip                fly through walls (the run counts as practice)
sv_airaccelerate 150  any sv_ cvar; off-default values make runs practice
sv_defaults           put the sv_ settings back
bind f "kill"         CS key names: mouse4, mwheelup, kp_end...
setgoal               mark the finish on maps that don't have one
cl_showfps 1          FPS counter
```

Commands chain with `;`, and quoted arguments work. A clear typo is corrected and run (`noclp` runs `noclip`).

## Map finishes

Surf timers normally keep their zones on the server, so the game looks for a finish in the map itself, in this order:

1. A timer or end trigger (`trigger_momentum_timer_stop`, or a trigger named like `end` or `finish`).
2. The teleport into the end room (a destination named `end…`).
3. The end of the last stage.

Maps with none of these show a message on load. On those, stand at the finish and type `setgoal`; it's saved for that map.

## Development

```bash
npm test          # vitest: movement, traces, BSP/VPK/vtex/KV3 parsers, models, console, records
npm run build     # type-check and production build
```

`test/maps-folder.test.ts` drives the real game tick through every imported map in both modes and reports falls, stuck spots and teleports. It skips itself when `public/maps` is empty.

| Area | Files |
| --- | --- |
| Movement and collision | `src/movement.ts`, `src/trace.ts`, `src/sim.ts`, `src/config.ts` |
| Maps | `src/bsp.ts`, `src/vpk.ts`, `src/vtf.ts`, `src/mapMaterials.ts`, `src/maps/` |
| CS2 assets | `src/kv3.ts`, `src/cs2.ts` (vtex), `src/cs2model.ts`, `src/cs2anim.ts`, `src/cs2finish.ts`, `src/finishMaterial.ts` |
| CS 1.6 model | `src/goldsrcmdl.ts` |
| Viewmodel | `src/viewmodel.ts`, `src/viewmodelPose.ts` |
| UI | `src/hud.ts`, `src/style.css`, `src/console.ts` |
| Import | `scripts/import-maps.ts` |

## Credits

- Arms: [FREE [FPS Arms] GameReady - RIGGED](https://sketchfab.com/3d-models/none-296d30fc705b4dff85c2c8a2d2724e7f) by bamenwo05, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Posed and animated for this game.
- Knife: [Karambit Knife](https://sketchfab.com/3d-models/none-554aac0e619e45f0a95b7c15cac7219c) by ediirawan, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Rigged into the hand, textures resized.

To rebuild them, unzip the two downloads into `arms/` and `knife/` in one folder (and the knife's inner `.rar` in place), then run `scripts/blender/fit_modern.py` in Blender with `MODELS` set to that folder.

## Disclaimer

This is a fan project. It isn't affiliated with or endorsed by Valve. Counter-Strike, CS:GO and CS2 are trademarks of Valve Corporation. The game ships no Valve assets; it only reads files from installs you own.
