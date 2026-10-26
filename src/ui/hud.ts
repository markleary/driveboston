/** Speed and street-name readout. */
export class Hud {
  private readonly root = document.getElementById('hud') as HTMLDivElement;
  private readonly speed = document.getElementById('speed-value') as HTMLSpanElement;
  private readonly street = document.getElementById('street-name') as HTMLSpanElement;
  private readonly cross = document.getElementById('cross-street') as HTMLSpanElement;
  private readonly badge = document.getElementById('badge') as HTMLDivElement;
  private lastSpeed = -1;
  private lastStreet = '';
  private lastCross = '';

  setBackend(label: string): void {
    this.badge.textContent = label;
  }

  update(speedMph: number, streetName: string, crossStreet: string): void {
    const rounded = Math.round(speedMph);
    if (rounded !== this.lastSpeed) {
      this.speed.textContent = String(rounded);
      this.lastSpeed = rounded;
    }
    if (streetName !== this.lastStreet) {
      this.street.textContent = streetName;
      this.lastStreet = streetName;
    }
    if (crossStreet !== this.lastCross) {
      this.cross.textContent = crossStreet;
      this.lastCross = crossStreet;
    }
  }

  toggle(): void {
    this.root.classList.toggle('hidden');
  }
}
