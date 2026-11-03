import { describe, it, expect } from 'vitest';
import { lzmaUnpack } from '../src/lzma';
import { readZip, writeZip } from '../src/pak';

// Made with Python's lzma module from original(): default settings, then lc=1 lp=2 pb=1.
const DEFAULT = 'TFpNQRAOAAAlBAAAXQAAAQAAbgEIRUv6hboIVDTm5cbHqrj+jf/gPIXWP/OCYKqGi8Jp9aV0Y9RnZFQoNhCiV5rpon/PGe9jRanuf/pSnD7p4UyOWVDYb+ju0n/40toCvX+YZZ/GcfAa5VPgS3QwGtXCnxCyoHJw2KP+yS/fuSF4B3CED4cd37dTeXA41KcEhIzmAzK7avUGuyKAcvYKZxFNwEjXe5c/XwLmAldRklpbIiVOBtda1rpqcWQIf1cT2CbctP0no78QRuwaQwDIlAZLPe3uB1uairoo1BYcfk6FXFtxvUGEoygVlfBWgcSWSEChiwKZY/okAqGAO3Ji2jW8JBx3g8A1qnJ8dqgH80xd1jKwnvjPsy9llnQXk9Ko5QAtwi2bR9/3NKaYdev465xBpfGpdwwCNIz+1/Wdgw7eJRdV0ZbsIFxalhTfk4cORhJr8/P0YRkRshz2GcgJ0kvpxpxTZzdAEYoe87KnwXvvUCMqYh/DiOea+T1aW6LlJV7t2cqsjQHSD2RI3FOOFa9VJBkSy0cKhPkM2rbcu7qmpf8dsNksRCdAdrNQ9Ve7t8fn/rY8kBiX8kzpkfxJh48qB76k6f0SmqQ86zEc3nzbe36doQBCwoYn0vRZjUfaT6xmdE+AneT13AS008S2aiOXOvLidHiwFIdj1c4RDq1N5L7TVk10SRsgIrIGqVQ/pvQi6U9E4neX/79lnAvT9RaBx3u2RP7qe+y/LpK1jLVTy7HFmesLUv+RyWxNhzC6vWUNf1x3md90TMArzGlsA3IY2dq8ujrGKTcHqThG9/EvkKfFj1IRIH3N1oMuYWZbOm40gBkoM0YZnjoR6DnRjLKdOU3fiuFW/Zxo1Xy1J+ON4vwQR81APF5ah2LDdoulrVWoZnPcUHd5Gkl3RMUASf/i2Csd1ZXY6slLivwbWToXyxwkVlO5tPS9uqsdGuWB/7gM3FgvSoQFJq1jobNe0PUZrcUKLF5IieG0ZGBfa9xKce8TyH0Vm91dHt8eNHZgMkLJzu50gBxiJppYSfXzshq+w9+HI+YYU6q8100eB5gWDIDfNAWkl1U+WKPHSrRN3700zagv8L8slMMpBchuoRJGisMJfPzVyVejuRg3WoethOenkXsiSpv2Tp0hGGbGowc6USGusxhD/IRrKFucnQkrBeQWpPlvxuBTWLKGpd+myh1VKEMdJHmCDN8DF54IpPJP8quyhpjCmc3RpUC8Ei9p9AIPifcQgXAHwkBzIJJplWIdVr0aHQriOL48S1GPf5JLqvhI41WAv989m3He5U3YukmEpBaf4wDGw9pDF2kJJU1o9yDudxnCwUuNHOr8Pdlia2M6E2uM7tD+wJCLiIpB8WFjGD8QCvi8rMMGh3aAHBpFQOdUjmH5vTKzNA9j3YYsSqWMTphMdmKZm9r2y///UhRwAA==';
const TUNED = 'TFpNQRAOAAAfBAAAQAAAAQAAbgEJEE3DMYztNsqyFKx1Z28S9CJhWJCqp7napJlkNuvd1XohUHEN7VAVbhDQZHJYuSe+KGGC56Fnis+ckh56RyIpVDn+PuvPUKvOrt0/LzoPl9dsCkGijBC0gqTqAUrW3eAcOCbkeSDj+K5/8un22mwThOhqsDBbHKS5YXji3tNaEziqYuGC/jbyoy/wwTE8NtC7Z7ssynMmzKQ5I0QCyq7dZLj5gypfX5egwMd5aBstHdR6Wbl/BK27z9kmATG0RqwrKnjsLMCVrK2ygYinlG17roDsp0C1AY+ZVGMaqWvo1o6n5kslRS0jbkdDjQnlpkloz4cexSx73xDAkdmprqyrr69QI6CQtDxzUGda1ZRa41hZmyJencFVpYQLoasOpQB30T5umF2CNAYmsa46jHogdKRPD7Hz1oaM9LYTLKS0xtp4lOtdCkLG0X+PMPrMjWvBjNfvBIBSj24atIF9Qqpxp/KlmBRLSyhIBI4lMO1Cj3gfopVypAiylKSyg/B1/AuaNu92C6x+OeFFnzEOauNmEcVQUFG9ljhSZPnvTsQ6dgD89RTp9/+Lnk0Ri4MSt01DZSx0pfjMNMD8yNMdeYX/n5QKkOWif2/Wtn7tXT1oP+klCud2fuaZ0wUCl7jg1nRzR0ll8JCIKIe1lLn5MOoqHS4UFmGn1o9CP/b2OTDxN5Vr9jifN5wSTTEwi00Gjn9u2FqFhFvXMm5E6DpxBsW+iNb3LCs1DCY3B9StVscAv+T/PUTPLetplO1QexZlkOhXWudvHzUpgn79ml73FbJ4UQZxZArmGxUJAIkKijyCNFT6y82jPqyTQ9et8zPBJL073kQMhzOXOJZCefMy0ICEr9qL4wWFf3cfPEUVPEQIbleEFEuEw53lFzE8uFLbjIXN5slFjop3XJsfoiBXD9JQL37sjB1xe2eE66+q9+ZU8GwH4ME8B8ogmsLdgjobQIu+q/IhyZw45GfK+cRPmnsIDn09/yQ9V1S9ai52UDbXY5IXstNQ7deAb9SYBxB0ouPEBSh8UJaKPveyxa/PuOC1JK3fs7CG6CxeKm5xa1V3PqTdq+H97NqtIEPLgN2LpdjWxw6UXiR+ui/eBLOA17RdvOcMTWeC1HLaGCLEo3oPzvXglsXaXM9dMSIpWZkA4lnCaPQ5AYPvnf9RW6mxf9VyAHkSys5X1u2OWm8MhRWL33sTiyyofPHvfgab+LdwlmeklHV23K7WGaFUMU0K8Wq4sYhQGn1cbjfKNt3tZq1QfLjB+ZIn8SsWc2gIy3b7KKDavLKJ88gNIbMJzdyfibF+jLILWpIk/+ZZXq4OOih6lXnJGqxBxaBGiR0AirJMPxPrE2A2TgATaKtt2XhSaMzNuHYQhLAvYYWal50a8mhOJ1LaMIWpnXL//QGZTA==';

const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function original() {
  let x = 12345;
  const noise = Array.from({ length: 1000 }, () => {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    return (x >> 16) & 255;
  });
  const text = Array.from(new TextEncoder().encode('surf surf surf surf '.repeat(20)));
  return Uint8Array.from([...noise, ...text, ...noise, ...text, ...new Array(300).fill(0), ...noise.slice(0, 500)]);
}

describe('readZip with LZMA entries', () => {
  // Rewrites the fixture's lump header as a zip entry's, then marks the entry as method 14 with its real size.
  const zipOf = (entry: Uint8Array, fullSize: number) => {
    const zip = writeZip(new Map([['Materials\\A.vmt', entry]]));
    const dv = new DataView(zip.buffer), central = zip.findIndex((_, i) => i + 4 <= zip.length && dv.getUint32(i, true) === 0x02014b50);
    dv.setUint16(central + 10, 14, true);
    dv.setUint32(central + 24, fullSize, true);
    return zip;
  };
  const packed = unb64(DEFAULT);
  const entry = Uint8Array.from([9, 38, 5, 0, ...packed.subarray(12)]);

  it('unpacks them when read, and when iterated', () => {
    const zip = readZip(zipOf(entry, original().length));
    expect(zip.has('materials/a.vmt')).toBe(true);
    expect([...zip]).toEqual([['materials/a.vmt', original()]]);
    expect(zip.get('materials/a.vmt')).toEqual(original());
  });
  it('a file set over a packed one replaces it', () => {
    const zip = readZip(zipOf(entry, original().length)), mine = Uint8Array.of(1, 2, 3);
    zip.set('materials/a.vmt', mine);
    expect(zip.get('materials/a.vmt')).toBe(mine);
  });
  it('treats a broken entry and one claiming too much as missing', () => {
    expect(readZip(zipOf(entry.subarray(0, 40), original().length)).get('materials/a.vmt')).toBeUndefined();
    expect(readZip(zipOf(entry, 0xffffffff)).get('materials/a.vmt')).toBeUndefined();
  });
});

describe('lzmaUnpack', () => {
  it.each([['default settings', DEFAULT], ['other settings', TUNED]])('unpacks %s', (_, packed) => {
    expect(lzmaUnpack(unb64(packed))).toEqual(original());
  });
  it('refuses bad input instead of returning garbage', () => {
    const good = unb64(DEFAULT);
    expect(() => lzmaUnpack(good.subarray(4))).toThrow(/not an LZMA/);
    expect(() => lzmaUnpack(good.subarray(0, 100))).toThrow(/header/);
    const huge = good.slice();
    new DataView(huge.buffer).setUint32(4, 0xffffffff, true);
    expect(() => lzmaUnpack(huge)).toThrow(/header/);
    const longer = good.slice();
    new DataView(longer.buffer).setUint32(4, 1 << 20, true); // claims more than the stream holds
    expect(() => lzmaUnpack(longer)).toThrow(/LZMA/);
  });
});
