import { describe, it, expect } from 'vitest';
import { recordFinish, parseRecords, recordKey, RECENT } from '../src/records';

describe('recordFinish', () => {
  it('first finish, then a slower one, then a new best', () => {
    let all = {};
    const a = recordFinish(all, 'csgo', 'surf_a', 62.5, 1000);
    expect(a.kind).toBe('first');
    expect(a.record).toMatchObject({ best: 62.5, bestAt: 1000, finishes: 1 });
    all = a.all;
    const b = recordFinish(all, 'csgo', 'surf_a', 65, 2000);
    expect(b.kind).toBe('slower');
    expect(b.delta).toBeCloseTo(2.5);
    expect(b.record.best).toBe(62.5);
    all = b.all;
    const c = recordFinish(all, 'csgo', 'surf_a', 60, 3000);
    expect(c.kind).toBe('pb');
    expect(c.delta).toBeCloseTo(-2.5);
    expect(c.record).toMatchObject({ best: 60, bestAt: 3000, finishes: 3 });
    expect(c.record.recent.map((r) => r.time)).toEqual([60, 65, 62.5]); // newest first
    expect(c.rank).toBe(1);
  });
  it('keeps games apart and ranks a time among recent finishes', () => {
    let all = recordFinish({}, 'csgo', 'surf_a', 50, 1).all;
    all = recordFinish(all, 'cs16', 'surf_a', 80, 2).all;
    expect(Object.keys(all).sort()).toEqual([recordKey('cs16', 'surf_a'), recordKey('csgo', 'surf_a')].sort());
    all = recordFinish(all, 'csgo', 'surf_a', 55, 3).all;
    expect(recordFinish(all, 'csgo', 'surf_a', 52, 4).rank).toBe(2);
  });
  it('keeps only the latest finishes', () => {
    let all = {};
    for (let i = 0; i < RECENT + 5; i++) all = recordFinish(all, 'csgo', 'm', 30 + i, i).all;
    expect(Object.values(all)[0]).toMatchObject({ finishes: RECENT + 5, best: 30 });
    expect((Object.values(all)[0] as { recent: unknown[] }).recent).toHaveLength(RECENT);
  });
});

describe('parseRecords', () => {
  it('drops junk and migrates old CS:GO bests', () => {
    const r = parseRecords('{"csgo:a":{"best":10,"bestAt":5,"finishes":2,"recent":[{"time":10,"at":5}]},"csgo:b":{"best":"x"},"cs16:c":{"best":-1}}', '{"surf_old":42,"bad":"x"}');
    expect(Object.keys(r).sort()).toEqual(['csgo:a', 'csgo:surf_old']);
    expect(r['csgo:surf_old']).toMatchObject({ best: 42, finishes: 1 });
    expect(parseRecords('not json', null)).toEqual({});
  });
});
