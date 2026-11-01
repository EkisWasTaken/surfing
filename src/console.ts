// Developer console, after CS's: statements split by ';', quoted arguments, commands and cvars.
export type Print = (text: string, tone?: 'error' | 'dim') => void;
type Cvar = { help: string; get: () => string; def?: () => string; set?: (v: string) => string | void }; // set returns an error message
type Command = { help: string; run: (args: string[], print: Print) => void };

// 'a; b "c; d"' → [['a'], ['b', 'c; d']]
export function tokenize(line: string): string[][] {
  const out: string[][] = [];
  let cur: string[] = [], tok = '', quoted = false, inTok = false;
  const endTok = () => {
    if (inTok) cur.push(tok);
    (tok = ''), (inTok = false);
  };
  for (const ch of line) {
    if (ch === '"') (quoted = !quoted), (inTok = true);
    else if (!quoted && ch === ';') endTok(), cur.length && out.push(cur), (cur = []);
    else if (!quoted && /\s/.test(ch)) endTok();
    else (tok += ch), (inTok = true);
  }
  endTok();
  if (cur.length) out.push(cur);
  return out;
}

export function createConsole() {
  const commands = new Map<string, Command>(), cvars = new Map<string, Cvar>();
  const names = () => [...commands.keys(), ...cvars.keys()].sort();
  const self = {
    command(name: string, help: string, run: Command['run']) {
      commands.set(name, { help, run });
    },
    cvar(name: string, help: string, c: Omit<Cvar, 'help'>) {
      cvars.set(name, { help, ...c });
    },
    execute(line: string, print: Print) {
      for (const [raw, ...args] of tokenize(line)) {
        const name = raw.toLowerCase(), cmd = commands.get(name), cv = cvars.get(name);
        if (cmd) cmd.run(args, print);
        else if (cv && !args.length) {
          print(`"${name}" = "${cv.get()}"${cv.def ? ` ( def. "${cv.def()}" )` : ''}`);
          print(` - ${cv.help}`, 'dim');
        } else if (cv) {
          const err = cv.set ? cv.set(args.join(' ')) : `${name} is read-only`;
          if (err) print(`${name}: ${err}`, 'error');
        } else print(`Unknown command "${raw}"`, 'error');
      }
    },
    // Names starting with the typed prefix (Tab completion).
    complete: (prefix: string) => names().filter((n) => n.startsWith(prefix.toLowerCase())),
    describe: (name: string) => commands.get(name)?.help ?? cvars.get(name)?.help ?? '',
  };
  self.command('help', 'List everything, or explain one: help <name>.', (a, print) => {
    if (a[0]) return print(self.describe(a[0].toLowerCase()) || `Unknown command "${a[0]}"`, self.describe(a[0].toLowerCase()) ? undefined : 'error');
    self.execute('cmdlist; cvarlist', print);
  });
  self.command('cmdlist', 'List commands.', (_, print) => [...commands.keys()].sort().forEach((n) => print(`${n.padEnd(22)} ${commands.get(n)!.help}`)));
  self.command('cvarlist', 'List settings (cvars) with their values.', (_, print) => [...cvars.keys()].sort().forEach((n) => print(`${n.padEnd(22)} = ${cvars.get(n)!.get().padEnd(8)} ${cvars.get(n)!.help}`)));
  self.command('find', 'Search command and cvar names and help: find <text>.', (a, print) => {
    const q = (a[0] ?? '').toLowerCase(), hits = names().filter((n) => n.includes(q) || self.describe(n).toLowerCase().includes(q));
    if (!hits.length) print(`Nothing matches "${q}"`, 'dim');
    hits.forEach((n) => print(`${n.padEnd(22)} ${self.describe(n)}`));
  });
  self.command('echo', 'Print text.', (a, print) => print(a.join(' ')));
  return self;
}

// KeyboardEvent.code → CS key name, as bind uses them.
const NUMPAD: Record<string, string> = { Numpad0: 'kp_ins', Numpad1: 'kp_end', Numpad2: 'kp_downarrow', Numpad3: 'kp_pgdn', Numpad4: 'kp_leftarrow', Numpad5: 'kp_5', Numpad6: 'kp_rightarrow', Numpad7: 'kp_home', Numpad8: 'kp_uparrow', Numpad9: 'kp_pgup', NumpadEnter: 'kp_enter', NumpadAdd: 'kp_plus', NumpadSubtract: 'kp_minus', NumpadMultiply: 'kp_multiply', NumpadDivide: 'kp_slash', NumpadDecimal: 'kp_del' };
const SPECIAL: Record<string, string> = { Space: 'space', Enter: 'enter', Tab: 'tab', Backspace: 'backspace', Escape: 'escape', CapsLock: 'capslock', Delete: 'del', Insert: 'ins', Home: 'home', End: 'end', PageUp: 'pgup', PageDown: 'pgdn', ArrowUp: 'uparrow', ArrowDown: 'downarrow', ArrowLeft: 'leftarrow', ArrowRight: 'rightarrow', Semicolon: 'semicolon', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`' };
export function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code.toLowerCase();
  if (/^(Shift|Control|Alt)(Left|Right)$/.test(code)) return code.startsWith('Control') ? 'ctrl' : code.replace(/(Left|Right)$/, '').toLowerCase();
  return NUMPAD[code] ?? SPECIAL[code] ?? code.toLowerCase();
}
