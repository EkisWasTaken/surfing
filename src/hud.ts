export function createHud(root: HTMLElement) {
  root.innerHTML = `
    <div class="crosshair"></div>
    <div class="speed">0</div>
    <div class="overlay">
      <h1>Surf Sandbox</h1>
      <p>Click to play</p>
      <p class="keys">WASD move · Mouse look · Space jump · C/Shift crouch · R respawn · Esc release</p>
    </div>`;
  const speed = root.querySelector<HTMLElement>('.speed')!;
  const overlay = root.querySelector<HTMLElement>('.overlay')!;
  return {
    setSpeed: (u: number) => (speed.textContent = String(Math.round(u))),
    showOverlay: (show: boolean) => (overlay.hidden = !show),
  };
}
