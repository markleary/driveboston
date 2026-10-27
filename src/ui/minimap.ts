import type { WorldData } from '../world/data.ts';

/** Map colours per ground class (lot, road, sidewalk, building, water, grass, paved, rail, parking). */
const CLASS_RGB: [number, number, number][] = [
  [214, 207, 196],
  [96, 101, 112],
  [198, 193, 184],
  [176, 160, 140],
  [120, 160, 208],
  [150, 190, 128],
  [190, 185, 176],
  [130, 126, 120],
  [168, 164, 156],
];
const VIEW_PX = 200;
/** Screen pixels per metre at the default zoom. */
const SCALE = 0.72;

/**
 * A round heading-up minimap in the corner, drawn from the ground mask (one
 * pixel per metre, rendered once) with traffic as dots and the player as a
 * chevron at the centre.
 */
export class Minimap {
  private readonly canvas = document.getElementById('minimap') as HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly dpr = Math.min(2, window.devicePixelRatio || 1);
  private hidden = false;

  constructor(world: WorldData) {
    const { mask, rect } = world;
    this.minX = rect.minX;
    this.minZ = rect.minZ;
    this.base = document.createElement('canvas');
    this.base.width = mask.width;
    this.base.height = mask.height;
    const bctx = this.base.getContext('2d')!;
    const image = bctx.createImageData(mask.width, mask.height);
    const px = image.data;
    for (let i = 0; i < mask.data.length; i += 1) {
      const rgb = CLASS_RGB[mask.data[i]] ?? CLASS_RGB[0];
      px[i * 4] = rgb[0];
      px[i * 4 + 1] = rgb[1];
      px[i * 4 + 2] = rgb[2];
      px[i * 4 + 3] = 255;
    }
    bctx.putImageData(image, 0, 0);
    this.canvas.width = VIEW_PX * this.dpr;
    this.canvas.height = VIEW_PX * this.dpr;
    this.ctx = this.canvas.getContext('2d')!;
  }

  toggle(): void {
    this.hidden = !this.hidden;
    this.canvas.classList.toggle('hidden', this.hidden);
  }

  /** Redraws around the player; `traffic` is x, z, dx, dz per car. */
  update(x: number, z: number, headingDeg: number, traffic: ArrayLike<number>): void {
    if (this.hidden) return;
    const { ctx, dpr } = this;
    const size = VIEW_PX * dpr;
    const half = size / 2;
    const scale = SCALE * dpr;
    const heading = (headingDeg * Math.PI) / 180;
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(half, half, half - 2 * dpr, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#d6cfc4';
    ctx.fillRect(0, 0, size, size);
    ctx.translate(half, half + 24 * dpr);
    ctx.rotate(-heading);
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, -(x - this.minX), -(z - this.minZ));
    // Traffic dots, in map metres.
    ctx.fillStyle = '#f2f0ea';
    const r = 2.2;
    for (let i = 0; i + 1 < traffic.length; i += 4) {
      const dx = traffic[i] - x;
      const dz = traffic[i + 1] - z;
      if (dx * dx + dz * dz > 260 * 260) continue;
      ctx.beginPath();
      ctx.arc(dx, dz, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // Player chevron, screen space.
    ctx.save();
    ctx.translate(half, half + 24 * dpr);
    ctx.fillStyle = '#c8553d';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, -9 * dpr);
    ctx.lineTo(6 * dpr, 7 * dpr);
    ctx.lineTo(0, 3.5 * dpr);
    ctx.lineTo(-6 * dpr, 7 * dpr);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // North mark on the rim.
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(-heading);
    ctx.fillStyle = '#1c1f26';
    ctx.font = `${11 * dpr}px Helvetica, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, -(half - 11 * dpr));
    ctx.restore();
    ctx.strokeStyle = 'rgba(232, 230, 225, 0.85)';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(half, half, half - 2 * dpr, 0, Math.PI * 2);
    ctx.stroke();
  }
}
