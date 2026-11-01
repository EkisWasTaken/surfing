// Original procedural desert textures (no external assets). Each canvas tiles seamlessly.

// Small deterministic PRNG so textures look the same every load.
function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

function speckle(ctx: CanvasRenderingContext2D, size: number, rand: () => number, count: number, alpha: number) {
  for (let i = 0; i < count; i++) {
    const v = rand() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${rand() * alpha})`;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

// Sandstone blocks in running bond: 4 rows × 2 blocks per tile.
export function sandstone(): HTMLCanvasElement {
  const S = 512, rand = rng(7);
  const [c, ctx] = canvas(S);
  const tones = ['#c8a26a', '#cfa970', '#bf9860', '#d4b07a', '#c49d64'];
  const rowH = S / 4, blockW = S / 2;
  for (let r = 0; r < 4; r++) {
    const off = r % 2 ? blockW / 2 : 0;
    for (let b = -1; b < 2; b++) {
      ctx.fillStyle = tones[Math.floor(rand() * tones.length)];
      ctx.fillRect(off + b * blockW, r * rowH, blockW, rowH);
      // Faint horizontal strata inside each block.
      for (let s = 0; s < 5; s++) {
        ctx.fillStyle = `rgba(120,80,40,${0.04 + rand() * 0.05})`;
        ctx.fillRect(off + b * blockW, r * rowH + rand() * rowH, blockW, 2 + rand() * 4);
      }
    }
  }
  speckle(ctx, S, rand, 9000, 0.12);
  // Mortar joints, drawn last so they sit on top.
  ctx.fillStyle = '#8a6a44';
  for (let r = 0; r <= 4; r++) ctx.fillRect(0, r * rowH - 3, S, 6);
  for (let r = 0; r < 4; r++) {
    const off = r % 2 ? blockW / 2 : 0;
    for (let x = off; x <= S; x += blockW) ctx.fillRect(x - 3, r * rowH, 6, rowH);
  }
  return c;
}

// Pale limestone floor tiles, 2×2 per tile.
export function limestone(): HTMLCanvasElement {
  const S = 512, rand = rng(11);
  const [c, ctx] = canvas(S);
  const tones = ['#ddd0b4', '#d6c8aa', '#e2d6bc', '#d1c2a2'];
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 2; x++) {
      ctx.fillStyle = tones[Math.floor(rand() * tones.length)];
      ctx.fillRect(x * 256, y * 256, 256, 256);
    }
  speckle(ctx, S, rand, 7000, 0.1);
  ctx.fillStyle = '#9c8b6c';
  for (let i = 0; i <= 2; i++) {
    ctx.fillRect(0, i * 256 - 2, S, 4);
    ctx.fillRect(i * 256 - 2, 0, 4, S);
  }
  return c;
}
