import { describe, it, expect } from 'vitest';
import { tokenize, createConsole, keyName } from '../src/console';

describe('tokenize', () => {
  it('splits statements on ; and keeps quoted text together', () => {
    expect(tokenize('kill; say "hi; there"  ; echo a b')).toEqual([['kill'], ['say', 'hi; there'], ['echo', 'a', 'b']]);
    expect(tokenize('bind f "kill; retry"')).toEqual([['bind', 'f', 'kill; retry']]);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('console', () => {
  const setup = () => {
    const out: string[] = [];
    let aa = 150;
    const con = createConsole();
    con.command('kill', 'Respawn.', () => out.push('killed'));
    con.cvar('sv_airaccelerate', 'Air acceleration.', { get: () => String(aa), def: () => '150', set: (v) => (Number.isFinite(+v) ? void (aa = +v) : 'not a number') });
    const run = (line: string) => con.execute(line, (t) => out.push(t));
    return { out, run, con, aa: () => aa };
  };
  it('runs commands and chained statements, case-insensitively', () => {
    const { out, run } = setup();
    run('KILL; kill');
    expect(out).toEqual(['killed', 'killed']);
  });
  it('prints a cvar with its default, sets it, and reports bad values', () => {
    const t = setup();
    t.run('sv_airaccelerate');
    expect(t.out[0]).toBe('"sv_airaccelerate" = "150" ( def. "150" )');
    t.run('sv_airaccelerate 100');
    expect(t.aa()).toBe(100);
    t.run('sv_airaccelerate fast');
    expect(t.out.at(-1)).toContain('not a number');
  });
  it('says what it does not know, lists, finds and completes', () => {
    const t = setup();
    t.run('noclipp');
    expect(t.out.at(-1)).toBe('Unknown command "noclipp"');
    t.run('find accel');
    expect(t.out.some((l) => l.includes('sv_airaccelerate'))).toBe(true);
    expect(t.con.complete('sv_a')).toEqual(['sv_airaccelerate']);
    expect(t.con.complete('k')).toEqual(['kill']);
  });
});

describe('keyName', () => {
  it('uses CS key names', () => {
    expect([keyName('KeyF'), keyName('Digit1'), keyName('Space'), keyName('ShiftLeft'), keyName('Numpad1'), keyName('ArrowUp'), keyName('F5')]).toEqual(['f', '1', 'space', 'shift', 'kp_end', 'uparrow', 'f5']);
  });
});
