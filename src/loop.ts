const MAX_FRAME = 0.25; // never simulate more than this per frame, avoids a catch-up spiral

export function createAccumulator(tickDt: number) {
  let acc = 0;
  return {
    advance(frameDt: number): number {
      acc += Math.min(frameDt, MAX_FRAME);
      const ticks = Math.floor(acc / tickDt);
      acc -= ticks * tickDt;
      return ticks;
    },
    alpha: () => acc / tickDt,
    reset() {
      acc = 0;
    },
  };
}
