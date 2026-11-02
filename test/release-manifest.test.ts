import { describe, it, expect } from 'vitest';
import { releaseManifest } from '../scripts/release-manifest';

describe('release manifest', () => {
  it('has what the updater reads', () => {
    expect(releaseManifest('1.2.3', ' sig\n', 'https://x/a.exe', new Date('2026-01-02T03:04:05Z'))).toEqual({
      version: '1.2.3',
      pub_date: '2026-01-02T03:04:05.000Z',
      platforms: { 'windows-x86_64': { signature: 'sig', url: 'https://x/a.exe' } },
    });
  });
  it('refuses a bad version, a missing signature and an insecure address', () => {
    expect(() => releaseManifest('v1.2', 's', 'https://x')).toThrow('version');
    expect(() => releaseManifest('1.2.3', '  ', 'https://x')).toThrow('signature');
    expect(() => releaseManifest('1.2.3', 's', 'http://x')).toThrow('secure');
  });
});
