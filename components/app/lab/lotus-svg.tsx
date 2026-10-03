'use client';

import { useEffect, useId, useState } from 'react';

import {
  DEFAULT_CONFIG,
  FACES,
  LIGHT_DIR,
  PADS,
  POD,
  SHADOW_TOKEN,
  STAMEN_COUNT,
  STAMEN_CROWN,
  padOutline,
  stamenPath,
  type Mix,
  breathEase,
  dot,
  openedMs,
  petalNormal,
  petalPoint,
  petalPoses,
  project,
  viewDir,
  type LotusConfig,
  type PetalPose,
  type Vec3,
} from '@/components/app/lab/lotus-model';

/**
 * Prototype B (t-131): the 3D lotus model projected to SVG paths, per frame.
 *
 * No new dependency. Petals are drawn in depth order (painter's algorithm)
 * with the seed pod and stamens as one item. How a petal is SHADED is the
 * variable under test — see `SvgLook`.
 */

const S = 100; // SVG units per model unit
const U_STEPS = 22;

/** Rendering choices a variation can make. */
export interface SvgLook {
  /**
   * flat    — one base→tip gradient per petal, lit once.
   * overlay — flat, plus a cross-width shade from the petal's real curvature.
   * strips  — the petal cut into lengthwise bands, each lit from its own normal.
   */
  shading: 'flat' | 'overlay' | 'strips';
  veins: boolean;
  outline: boolean;
  /** teal: the brand tiers. pale: near-white bodies, teal only at the tips. */
  palette: 'teal' | 'pale';
}

export const DEFAULT_LOOK: SvgLook = {
  shading: 'flat',
  veins: true,
  outline: true,
  palette: 'teal',
};

interface Item {
  depth: number;
  node: React.ReactNode;
}

/** Two decimals everywhere: Node and the browser disagree in the last digits. */
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A `Mix` as CSS. */
function mixCss(m: Mix): string {
  const c = (x: string) => (x.startsWith('--') ? `var(${x})` : x);
  if (!m.b || !m.t) return c(m.a);
  return `color-mix(in oklab, ${c(m.a)}, ${c(m.b)} ${Math.round(m.t * 100)}%)`;
}

/** Lambert plus a sky term, so faces turned up read brighter — like the 3D light. */
function lightAt(n: Vec3): number {
  return 0.25 + 0.42 * Math.max(0, dot(n, LIGHT_DIR)) + 0.33 * (0.5 + 0.5 * n[1]);
}

/** light ∈ [0,1]: below 0.5 darkens toward black, above lightens toward white. */
function shadeColor(color: string, light: number, shadow: string = SHADOW_TOKEN): string {
  if (light < 0.5) {
    // Toward a teal, not black: shadows on a white petal read cool.
    const k = Math.round((0.5 - light) * 2 * 55);
    return `color-mix(in oklab, ${color}, var(${shadow}) ${k}%)`;
  }
  const k = Math.round((light - 0.5) * 2 * 14);
  return `color-mix(in oklab, ${color}, white ${k}%)`;
}

/** The face colour at a point along the petal, as a CSS colour. */
function faceColor(stops: readonly Mix[], u: number): string {
  const [a, b, c] = stops.map(mixCss);
  if (u <= 0.5) return `color-mix(in oklab, ${a}, ${b} ${Math.round(u * 200)}%)`;
  return `color-mix(in oklab, ${b}, ${c} ${Math.round((u - 0.5) * 200)}%)`;
}

class Projector {
  constructor(readonly cfg: LotusConfig) {}
  pt(p: Vec3): string {
    const s = project(p, this.cfg);
    return `${r2(s.x * S)} ${r2(s.y * S)}`;
  }
  sv(p: Vec3): { x: number; y: number } {
    const s = project(p, this.cfg);
    return { x: r2(s.x * S), y: r2(s.y * S) };
  }
}

function petalItem(pose: PetalPose, key: string, gid: string, look: SvgLook, P: Projector): Item {
  const view = viewDir(pose.cfg);
  const edge = (v: number, from = 0, to = 1) => {
    const out: string[] = [];
    for (let i = 0; i <= U_STEPS; i++)
      out.push(P.pt(petalPoint(pose, from + ((to - from) * i) / U_STEPS, v)));
    return out;
  };
  const outline = (v0: number, v1: number) =>
    `M${edge(v0).join('L')}L${edge(v1).reverse().join('L')}Z`;

  const palette = look.palette === 'pale' ? FACES['white-tipped'] : FACES[pose.tier.face];
  const facesFor = (outward: boolean) => (outward ? palette.outer : palette.inner);

  const n0 = petalNormal(pose, 0.55, 0);
  const facingOut = dot(n0, view) > 0;
  const base = P.sv(petalPoint(pose, 0.02, 0));
  const tip = P.sv(petalPoint(pose, 1, 0));
  const id = `${gid}-${key}`;
  const nodes: React.ReactNode[] = [];
  const defs: React.ReactNode[] = [];

  const lengthGradient = (gidk: string, v: number, from: Vec3 | null = null) => {
    // Lit stops along the length at this v, each from its own normal.
    const stops: React.ReactNode[] = [];
    for (const u of [0.04, 0.3, 0.55, 0.8, 0.98]) {
      let n = petalNormal(pose, u, v);
      const out = dot(n, view) > 0;
      if (!out) n = [-n[0], -n[1], -n[2]];
      const light = r2(0.5 + (lightAt(from ?? n) - 0.5) * pose.cfg.exposure);
      stops.push(
        <stop
          key={u}
          offset={`${Math.round(u * 100)}%`}
          stopColor={shadeColor(faceColor(facesFor(out), u), light, pose.cfg.shadowTone)}
        />
      );
    }
    const b = P.sv(petalPoint(pose, 0, v));
    const t = P.sv(petalPoint(pose, 1, v));
    defs.push(
      <linearGradient
        key={gidk}
        id={gidk}
        gradientUnits="userSpaceOnUse"
        x1={b.x}
        y1={b.y}
        x2={t.x}
        y2={t.y}
      >
        {stops}
      </linearGradient>
    );
  };

  if (look.shading === 'strips') {
    const K = 7;
    for (let k = 0; k < K; k++) {
      const v0 = -1 + (2 * k) / K;
      const v1 = v0 + 2 / K;
      const gk = `${id}-s${k}`;
      lengthGradient(gk, (v0 + v1) / 2);
      // Stroking with the band's own fill closes the hairline seams.
      nodes.push(
        <path
          key={gk}
          d={outline(v0, v1)}
          fill={`url(#${gk})`}
          stroke={`url(#${gk})`}
          strokeWidth={0.6}
          strokeLinejoin="round"
        />
      );
    }
  } else {
    const faceN: Vec3 = facingOut ? n0 : [-n0[0], -n0[1], -n0[2]];
    lengthGradient(`${id}-l`, 0, faceN);
    nodes.push(<path key="body" d={outline(-1, 1)} fill={`url(#${id}-l)`} />);

    if (look.shading === 'overlay') {
      // Across the width at mid-length: dark where the cup turns away.
      const a = P.sv(petalPoint(pose, 0.55, -1));
      const b = P.sv(petalPoint(pose, 0.55, 1));
      const stops: React.ReactNode[] = [];
      for (let i = 0; i <= 6; i++) {
        const v = -1 + i / 3;
        let n = petalNormal(pose, 0.55, v);
        if (dot(n, view) < 0) n = [-n[0], -n[1], -n[2]];
        const l = lightAt(n);
        const ref = lightAt(faceN);
        const d = l - ref; // relative to the body's single light
        stops.push(
          <stop
            key={i}
            offset={`${Math.round((i / 6) * 100)}%`}
            stopColor={d < 0 ? 'black' : 'white'}
            stopOpacity={r2(Math.min(0.55, Math.abs(d) * (d < 0 ? 1.6 : 1.1)))}
          />
        );
      }
      defs.push(
        <linearGradient
          key="x"
          id={`${id}-x`}
          gradientUnits="userSpaceOnUse"
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
        >
          {stops}
        </linearGradient>
      );
      nodes.push(<path key="shade" d={outline(-1, 1)} fill={`url(#${id}-x)`} />);
    }
  }

  if (look.outline) {
    nodes.push(
      <path
        key="edge"
        d={outline(-1, 1)}
        fill="none"
        stroke={`var(${palette.edge})`}
        strokeOpacity={0.5}
        strokeWidth={0.6}
        strokeLinejoin="round"
      />
    );
  }
  if (look.veins) {
    const veins = [-0.55, -0.28, 0, 0.28, 0.55].map((v) => {
      const pts: string[] = [];
      for (let i = 2; i <= 17; i++) pts.push(P.pt(petalPoint(pose, i / 20, v)));
      return `M${pts.join('L')}`;
    });
    nodes.push(
      <path
        key="veins"
        d={veins.join('')}
        fill="none"
        stroke="var(--color-lotus-vein)"
        strokeOpacity={facingOut ? 0.16 : 0.36}
        strokeWidth={0.45}
        strokeLinecap="round"
      />
    );
  }
  void base;
  void tip;

  return {
    depth: dot(petalPoint(pose, 0.5, 0), view),
    node: (
      <g key={key}>
        <defs>{defs}</defs>
        {nodes}
      </g>
    ),
  };
}

function ring(r: number, y: number, a: number): Vec3 {
  return [r * Math.cos(a), y, r * Math.sin(a)];
}

/** The water lily's crown: every stamen its own depth item, so petals interleave. */
function crownItems(grow: number, P: Projector): Item[] {
  const view = viewDir(P.cfg);
  const items: Item[] = [];
  const g = Math.max(0.001, grow);
  const tones = ['--color-lotus-core', '--color-lotus-core-light', '--color-lotus-core'];
  for (let i = 0; i < STAMEN_CROWN; i++) {
    const path = stamenPath(i, g);
    const d = `M${path.map((p) => P.pt(p)).join('L')}`;
    const mid = path[3];
    items.push({
      depth: dot(mid, view) + 0.001,
      node: (
        <g key={`st${i}`}>
          <path
            d={d}
            fill="none"
            stroke={`var(${tones[i % 3]})`}
            strokeWidth={r2(2.6 - (i / STAMEN_CROWN) * 0.8)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={`M${P.pt(path[4])}L${P.pt(path[6])}`}
            stroke="var(--color-lotus-glint)"
            strokeOpacity={0.7}
            strokeWidth={1}
            strokeLinecap="round"
          />
        </g>
      ),
    });
  }
  // A warm glow at the heart, under everything in the crown.
  const c = P.sv([0, POD.bottom + 0.06, 0]);
  items.push({
    depth: -0.5,
    node: (
      <ellipse
        key="glow"
        cx={c.x}
        cy={c.y}
        rx={22}
        ry={13}
        fill="var(--color-lotus-core-light)"
        opacity={r2(0.45 * g)}
      />
    ),
  });
  return items;
}

/** Pod and stamens as one depth item at the flower's centre. */
function coreItem(gid: string, grow: number, P: Projector): Item {
  const g = Math.max(0.0001, grow);
  const stamens = (front: boolean) => {
    const out: React.ReactNode[] = [];
    for (let i = 0; i < STAMEN_COUNT; i++) {
      const a = (i / STAMEN_COUNT) * Math.PI * 2 + (i % 2) * 0.05;
      if (Math.sin(a) > 0 !== front) continue;
      const r0 = POD.radiusBottom * 1.05;
      const r1 = (POD.radiusTop + 0.08 + (i % 3) * 0.022) * (0.6 + 0.4 * g);
      const y1 = POD.bottom + (0.2 + (i % 4) * 0.02) * g;
      const p0 = P.sv(ring(r0, POD.bottom + 0.02, a));
      const p1 = P.sv(ring(r1, y1, a));
      out.push(
        <g key={i}>
          <line
            x1={p0.x}
            y1={p0.y}
            x2={p1.x}
            y2={p1.y}
            stroke="var(--color-lotus-core-light)"
            strokeWidth={0.8}
            strokeLinecap="round"
          />
          <circle cx={p1.x} cy={p1.y} r={1.5} fill="var(--color-lotus-glint)" />
        </g>
      );
    }
    return out;
  };

  const top = POD.bottom + (POD.top - POD.bottom) * g;
  const rt = POD.radiusTop * (0.55 + 0.45 * g);
  const rb = POD.radiusBottom;
  const N = 24;
  const side: string[] = [];
  for (let i = 0; i <= N; i++) side.push(P.pt(ring(rb, POD.bottom, Math.PI - (i / N) * Math.PI)));
  const topFront: string[] = [];
  for (let i = 0; i <= N; i++) topFront.push(P.pt(ring(rt, top, (i / N) * Math.PI)));
  const sidePath = `M${P.pt(ring(rt, top, Math.PI))}L${side.join('L')}L${P.pt(ring(rt, top, 0))}L${topFront.join('L')}Z`;

  const c = P.sv([0, top, 0]);
  const e = P.sv([rt, top, 0]);
  const f = P.sv([0, top, rt]);
  const rx = r2(Math.abs(e.x - c.x));
  const ry = r2(Math.abs(f.y - c.y));

  const seeds = [
    [0, 0],
    ...Array.from({ length: 7 }, (_, i) => [0.62, (i / 7) * Math.PI * 2 + 0.3]),
  ].map(([r, a], i) => {
    const p = P.sv(ring(rt * r, top, a));
    return (
      <ellipse
        key={i}
        cx={p.x}
        cy={p.y}
        rx={r2(rt * S * 0.13)}
        ry={r2(rt * S * 0.13 * (ry / Math.max(rx, 0.01)))}
        fill="var(--color-lotus-core-deep)"
        opacity={0.75}
      />
    );
  });

  return {
    depth: dot([0, top * 0.5, 0], viewDir(P.cfg)),
    node: (
      <g key="core" opacity={r2(Math.min(1, grow * 1.6))}>
        {stamens(false)}
        <path d={sidePath} fill="var(--color-lotus-core-deep)" />
        <ellipse cx={c.x} cy={c.y} rx={rx} ry={ry} fill={`url(#${gid}-pod)`} />
        {seeds}
        {stamens(true)}
      </g>
    ),
  };
}

export interface LotusSvgProps {
  size?: number;
  /** Freeze at this many ms into the opening (prototype screenshots). */
  frozenMs?: number;
  reducedMotion?: boolean;
  /** Bump to replay. */
  playKey?: number;
  water?: boolean;
  config?: LotusConfig;
  look?: Partial<SvgLook>;
}

export function LotusSvg({
  size = 300,
  frozenMs,
  reducedMotion,
  playKey = 0,
  water = true,
  config = DEFAULT_CONFIG,
  look: lookOver,
}: LotusSvgProps) {
  const look = { ...DEFAULT_LOOK, ...lookOver };
  const gid = `lsvg${useId().replace(/:/g, '')}`;
  const done = openedMs(config);
  const [ms, setMs] = useState(frozenMs ?? (reducedMotion ? done : 0));

  useEffect(() => {
    if (frozenMs !== undefined) {
      setMs(frozenMs);
      return;
    }
    if (reducedMotion) {
      setMs(done);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const elapsed = now - t0;
      setMs(elapsed);
      if (elapsed < done + 100) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frozenMs, reducedMotion, playKey, done]);

  const P = new Projector(config);
  const poses = petalPoses(ms, config);
  const grow = breathEase(Math.min(1, Math.max(0, (ms - 500) / 1600)));
  const items: Item[] = poses.map((p) => petalItem(p, `${p.tier.name}${p.index}`, gid, look, P));
  if (config.centre === 'stamens') items.push(...crownItems(grow, P));
  else items.push(coreItem(gid, grow, P));
  items.sort((a, b) => a.depth - b.depth);

  const ripple = breathEase(Math.min(1, Math.max(0, (ms - 300) / 2600)));
  const rippleY = r2(project([0, 0, 0], config).y * S + 4);

  const vb = { x: -150, y: -132, w: 300, h: 187 };
  return (
    <svg
      width={size}
      height={(size * vb.h) / vb.w}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      aria-hidden="true"
      focusable="false"
      className="overflow-visible"
    >
      <defs>
        <radialGradient id={`${gid}-pod`} cx="45%" cy="40%" r="65%">
          <stop offset="0%" stopColor="var(--color-lotus-core-light)" />
          <stop offset="60%" stopColor="var(--color-lotus-core)" />
          <stop offset="100%" stopColor="var(--color-lotus-core-deep)" />
        </radialGradient>
        <radialGradient id={`${gid}-halo`} cx="50%" cy="55%" r="50%">
          <stop offset="0%" stopColor="var(--color-lotus-halation)" />
          <stop offset="100%" stopColor="var(--color-lotus-halation)" stopOpacity={0} />
        </radialGradient>
      </defs>
      {config.pads &&
        PADS.map((pad, k) => (
          <path
            key={`pad${k}`}
            d={`M${padOutline(pad)
              .map((p) => P.pt(p))
              .join('L')}Z`}
            fill="color-mix(in oklab, var(--color-lotus-petal-outer-edge), black 35%)"
            stroke="color-mix(in oklab, var(--color-lotus-petal-outer), black 20%)"
            strokeWidth={0.8}
            opacity={r2(0.85 * ripple)}
          />
        ))}
      {water && (
        <>
          <ellipse
            cx={0}
            cy={-35}
            rx={150}
            ry={95}
            fill={`url(#${gid}-halo)`}
            opacity={r2(ripple)}
          />
          <g
            fill="none"
            strokeLinecap="round"
            opacity={r2(ripple)}
            transform={`translate(0 ${rippleY}) scale(${r2(0.55 + 0.45 * ripple)})`}
          >
            {[
              { rx: 70, ry: 12, o: 0.55, w: 1.4, c: '--color-lotus-ripple' },
              { rx: 104, ry: 18, o: 0.34, w: 1.2, c: '--color-lotus-ripple' },
              { rx: 136, ry: 24, o: 0.2, w: 1.0, c: '--color-lotus-ripple-far' },
            ].map((r) => (
              <ellipse
                key={r.rx}
                rx={r.rx}
                ry={r.ry}
                stroke={`var(${r.c})`}
                strokeOpacity={r.o}
                strokeWidth={r.w}
              />
            ))}
          </g>
        </>
      )}
      {items.map((i) => i.node)}
    </svg>
  );
}
