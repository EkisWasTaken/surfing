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

// Mouse is read once per frame; give each tick its share of the turn, as if sampled every tick.
// Without this, extra ticks in a frame get no turn and air strafing loses up to half its gain.
export const tickYaw = (fromYaw: number, toYaw: number, i: number, ticks: number) => fromYaw + ((toYaw - fromYaw) * (i + 1)) / ticks;
