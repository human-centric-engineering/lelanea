import {
  colourCss,
  colourRgba,
  parseColour,
  rgbaString,
  type Colour,
  type Rgba,
} from '@/components/app/ui/lotus-colour';
import type { LotusFrame, LotusShape } from '@/components/app/ui/lotus-draw';

/**
 * Paint a lotus draw list onto a canvas.
 *
 * The animation's painter. SVG would show the same thing, but rebuilding ~240
 * shaded gradient paths through React sixty times a second measured ~28fps
 * on a desktop in t-131; a canvas repaint is a few milliseconds.
 *
 * A canvas cannot read `var()`, so `token` resolves each `--color-lotus-*`
 * name once (from computed style) and colours are mixed in JS, in OKLab, the
 * same way the SVG's `color-mix(in oklab, …)` does.
 */
export function tokenReader(element: Element): (name: string) => Rgba {
  const style = getComputedStyle(element);
  const cache = new Map<string, Rgba>();
  return (name) => {
    let value = cache.get(name);
    if (!value) {
      value = parseColour(style.getPropertyValue(name)) ?? [0, 0, 0, 0];
      cache.set(name, value);
    }
    return value;
  };
}

/**
 * A painter bound to one set of resolved tokens. Colours are memoised by their
 * CSS form across frames — the same few hundred mixes recur every frame.
 */
export type LotusPaint = (
  ctx: CanvasRenderingContext2D,
  shapes: readonly LotusShape[],
  frame: LotusFrame,
  pixelWidth: number
) => void;

export function lotusPainter(token: (name: string) => Rgba): LotusPaint {
  const memo = new Map<string, Rgba>();
  const rgba = (c: Colour) => {
    const key = typeof c === 'string' ? c : colourCss(c);
    let v = memo.get(key);
    if (v === undefined) {
      v = colourRgba(c, token);
      memo.set(key, v);
    }
    return v;
  };
  return (ctx, shapes, frame, pixelWidth) => paint(ctx, shapes, frame, pixelWidth, rgba);
}

function paint(
  ctx: CanvasRenderingContext2D,
  shapes: readonly LotusShape[],
  frame: LotusFrame,
  pixelWidth: number,
  rgba: (c: Colour) => Rgba
) {
  const css = (c: Colour) => rgbaString(rgba(c));
  const [bx, by, bw] = frame.box;
  const k = pixelWidth / bw;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(k, 0, 0, k, -bx * k, -by * k);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const trace = (pts: readonly number[], close: boolean) => {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    if (close) ctx.closePath();
  };

  for (const s of shapes) {
    ctx.globalAlpha = 1;
    switch (s.kind) {
      case 'band': {
        const g = ctx.createLinearGradient(s.from[0], s.from[1], s.to[0], s.to[1]);
        for (const stop of s.stops) g.addColorStop(stop.offset, css(stop.colour));
        trace(s.points, true);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = g;
        ctx.lineWidth = 0.6;
        ctx.stroke();
        break;
      }
      case 'line':
        trace(s.points, false);
        ctx.globalAlpha = s.opacity;
        ctx.strokeStyle = css(s.colour);
        ctx.lineWidth = s.width;
        ctx.stroke();
        break;
      case 'fill':
        trace(s.points, true);
        ctx.globalAlpha = s.opacity;
        ctx.fillStyle = css(s.colour);
        ctx.fill();
        ctx.strokeStyle = css(s.stroke);
        ctx.lineWidth = s.strokeWidth;
        ctx.stroke();
        break;
      case 'ring':
        ctx.beginPath();
        ctx.ellipse(s.cx, s.cy, s.rx, s.ry, 0, 0, Math.PI * 2);
        ctx.globalAlpha = s.opacity;
        ctx.strokeStyle = css(s.colour);
        ctx.lineWidth = s.width;
        ctx.stroke();
        break;
      case 'glow': {
        if (s.opacity <= 0) break;
        const [r, g, b, a] = rgba(s.colour);
        ctx.save();
        ctx.translate(s.cx, s.cy);
        ctx.scale(1, s.ry / s.rx);
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, s.rx);
        grad.addColorStop(0, rgbaString([r, g, b, a]));
        grad.addColorStop(1, rgbaString([r, g, b, 0]));
        ctx.globalAlpha = s.opacity;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, s.rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
    }
  }
  ctx.restore();
}
