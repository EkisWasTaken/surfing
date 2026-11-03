// LZMA decoder for Source's compressed BSP lumps. The input is untrusted: bad data throws, and output never passes the stated size.
const MAX_SIZE = 512 << 20;
const IS_MATCH = 0, IS_REP = 192, REP_G0 = 204, REP_G1 = 216, REP_G2 = 228, REP0_LONG = 240, POS_SLOT = 432, POS = 688, ALIGN = 803, LEN = 819, REP_LEN = 1333, LITERAL = 1847;

// Source's lump header: 'LZMA', unpacked size, packed size, 5 property bytes, then the stream.
export function lzmaUnpack(src: Uint8Array): Uint8Array {
  const head = new DataView(src.buffer, src.byteOffset, src.byteLength);
  if (src.length < 17 || head.getUint32(0, true) !== 0x414d5a4c) throw new Error('not an LZMA lump');
  const size = head.getUint32(4, true), packed = head.getUint32(8, true);
  if (packed < 5 || 17 + packed > src.length) throw new Error('bad LZMA header');
  return decode(src, 17, 17 + packed, src[12], size);
}

// A zip entry using method 14: version (2 bytes), property size (2 bytes), 5 property bytes, then the stream.
export function lzmaUnpackZipEntry(src: Uint8Array, size: number): Uint8Array {
  if (src.length < 14 || src[2] !== 5 || src[3] !== 0) throw new Error('bad LZMA header');
  return decode(src, 9, src.length, src[4], size);
}

// The output buffer stands in for the dictionary, so the dictionary size in the properties isn't needed.
function decode(src: Uint8Array, start: number, end: number, props: number, size: number): Uint8Array {
  if (size > MAX_SIZE || props >= 225) throw new Error('bad LZMA header');
  const lc = props % 9, lp = Math.floor(props / 9) % 5, pb = Math.floor(props / 45);
  const out = new Uint8Array(size);
  const probs = new Uint16Array(LITERAL + (0x300 << (lc + lp))).fill(1024);

  let p = start + 1; // the stream's first byte is always 0
  let range = 0xffffffff, code = 0;
  for (let i = 0; i < 4; i++) code = (code * 256 + src[p++]) >>> 0;
  const normalize = () => {
    if (range < 0x1000000) {
      range = (range * 256) >>> 0;
      code = (code * 256 + src[p++]) >>> 0;
    }
  };
  const bit = (i: number) => {
    const prob = probs[i], bound = (range >>> 11) * prob;
    let b = 0;
    if (code < bound) {
      range = bound;
      probs[i] = prob + ((2048 - prob) >> 5);
    } else {
      range -= bound;
      code -= bound;
      probs[i] = prob - (prob >> 5);
      b = 1;
    }
    normalize();
    return b;
  };
  const tree = (base: number, bits: number) => {
    let m = 1;
    for (let i = 0; i < bits; i++) m = m * 2 + bit(base + m);
    return m - (1 << bits);
  };
  const reverseTree = (base: number, bits: number) => {
    let m = 1, sym = 0;
    for (let i = 0; i < bits; i++) {
      const b = bit(base + m);
      m = m * 2 + b;
      sym |= b << i;
    }
    return sym;
  };
  const length = (base: number, posState: number) => {
    if (!bit(base)) return tree(base + 2 + posState * 8, 3);
    if (!bit(base + 1)) return 8 + tree(base + 130 + posState * 8, 3);
    return 16 + tree(base + 258, 8);
  };

  const posMask = (1 << pb) - 1, litMask = (1 << lp) - 1;
  let state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0, n = 0;
  while (n < size) {
    if (p > end) throw new Error('LZMA stream ends early');
    const posState = n & posMask;
    if (!bit(IS_MATCH + (state << 4) + posState)) {
      const base = LITERAL + 0x300 * (((n & litMask) << lc) + ((n ? out[n - 1] : 0) >> (8 - lc)));
      let sym = 1;
      if (state >= 7) {
        // Just after a match, the byte that match would have continued with predicts this one, until they differ.
        let match = out[n - rep0 - 1];
        while (sym < 0x100) {
          const mb = (match >> 7) & 1;
          match <<= 1;
          const b = bit(base + ((1 + mb) << 8) + sym);
          sym = sym * 2 + b;
          if (mb !== b) break;
        }
      }
      while (sym < 0x100) sym = sym * 2 + bit(base + sym);
      out[n++] = sym;
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
      continue;
    }
    let len: number;
    if (bit(IS_REP + state)) {
      if (rep0 >= n) throw new Error('LZMA distance is out of range');
      if (!bit(REP_G0 + state)) {
        if (!bit(REP0_LONG + (state << 4) + posState)) {
          state = state < 7 ? 9 : 11;
          out[n] = out[n - rep0 - 1];
          n++;
          continue;
        }
      } else {
        let d: number;
        if (!bit(REP_G1 + state)) d = rep1;
        else {
          if (!bit(REP_G2 + state)) d = rep2;
          else (d = rep3), (rep3 = rep2);
          rep2 = rep1;
        }
        rep1 = rep0;
        rep0 = d;
      }
      len = length(REP_LEN, posState);
      state = state < 7 ? 8 : 11;
    } else {
      rep3 = rep2;
      rep2 = rep1;
      rep1 = rep0;
      len = length(LEN, posState);
      state = state < 7 ? 7 : 10;
      const slot = tree(POS_SLOT + (Math.min(len, 3) << 6), 6);
      if (slot < 4) rep0 = slot;
      else {
        const bits = (slot >> 1) - 1;
        rep0 = (2 + (slot & 1)) * 2 ** bits; // can reach 2^32, past what bit shifts hold
        if (slot < 14) rep0 += reverseTree(POS + rep0 - slot, bits);
        else {
          let direct = 0;
          for (let i = bits - 4; i > 0; i--) {
            range >>>= 1;
            const b = code >= range ? 1 : 0;
            if (b) code -= range;
            direct = direct * 2 + b;
            normalize();
          }
          rep0 += direct * 16 + reverseTree(ALIGN, 4);
        }
        if (rep0 === 0xffffffff) break; // end marker
      }
    }
    len += 2;
    if (rep0 >= n || n + len > size) throw new Error('LZMA match is out of range');
    for (const stop = n + len; n < stop; n++) out[n] = out[n - rep0 - 1];
  }
  if (n !== size) throw new Error('LZMA stream ends early');
  return out;
}
