import { lotusConfig, type LotusConfig, type PetalTier } from '@/components/app/lab/lotus-model';
import type { SvgLook } from '@/components/app/lab/lotus-svg';

/** t-131: the variations on the lab bench, numbered so the owner can name one. */
export interface LotusVariant {
  id: string;
  label: string;
  renderer: 'svg' | 'three';
  config: LotusConfig;
  look?: Partial<SvgLook>;
  /** 'photo' — after the owner's reference photo; 'earlier' — round one. */
  set?: 'photo' | 'earlier';
}

/**
 * After the reference photo: four broad sepals flat on the water, then four
 * whorls of slender pointed white petals rising toward the centre, around a
 * crown of orange stamens.
 */
const LILY_TIERS: PetalTier[] = [
  {
    name: 'sepal',
    face: 'sepal',
    count: 4,
    length: 1.0,
    width: 0.24,
    tiltBud: 14,
    tiltOpen: 97,
    phase: 45,
    ring: 0.14,
    start: 0,
  },
  {
    name: 'p1',
    face: 'white',
    count: 8,
    length: 1.02,
    width: 0.18,
    tiltBud: 12,
    tiltOpen: 84,
    phase: 22.5,
    ring: 0.13,
    start: 160,
  },
  {
    name: 'p2',
    face: 'white',
    count: 8,
    length: 0.96,
    width: 0.17,
    tiltBud: 9,
    tiltOpen: 66,
    phase: 0,
    ring: 0.11,
    start: 340,
  },
  {
    name: 'p3',
    face: 'white',
    count: 8,
    length: 0.86,
    width: 0.16,
    tiltBud: 6,
    tiltOpen: 56,
    phase: 11,
    ring: 0.09,
    start: 500,
  },
  {
    name: 'p4',
    face: 'white',
    count: 6,
    length: 0.66,
    width: 0.15,
    tiltBud: 4,
    tiltOpen: 42,
    phase: 30,
    ring: 0.07,
    start: 640,
  },
];

const lily = (over: Parameters<typeof lotusConfig>[0] = {}) =>
  lotusConfig({
    tiers: LILY_TIERS,
    shapeA: 0.9,
    shapeB: 1.05,
    elevation: 30,
    curlOpen: 0.16,
    cupOpen: 0.45,
    centre: 'stamens',
    jitter: 1.6,
    exposure: 0.62,
    shadowTone: '--color-lotus-petal-mid',
    ...over,
  });
const lilyTipped = lily({
  tierOverrides: {
    p1: { face: 'white-tipped' },
    p2: { face: 'white-tipped' },
    p3: { face: 'white-tipped' },
    p4: { face: 'white-tipped' },
  },
});
const lilyBroad = lily({ widthScale: 1.35, shapeB: 0.95 });
const lilyPointier = lily({ shapeA: 1.0, shapeB: 1.45, widthScale: 1.1 });
const c1Crown = lotusConfig({ centre: 'stamens' });

/** R9's flower in the mark's own colours: deep teal outside, light aqua at the heart. */
const tealTiers = {
  sepal: { face: 'teal-outer' as const },
  p1: { face: 'teal-outer' as const },
  p2: { face: 'teal-mid' as const },
  p3: { face: 'teal-inner' as const },
  p4: { face: 'teal-inner' as const },
};
const lilyTeal = lily({
  exposure: 1,
  shadowTone: '--color-lotus-petal-outer',
  tierOverrides: tealTiers,
});
const lilyTealWarmSepals = lily({
  exposure: 1,
  shadowTone: '--color-lotus-petal-outer',
  tierOverrides: { ...tealTiers, sepal: { face: 'sepal' as const } },
});
const banded = { shading: 'strips', veins: false, outline: false } as const;

/** T1 × R1: blend kind applied tier by tier (sepals/outer → outer tone, …). */
const blend = (kind: 'tip' | 'under' | 'half', pads = false) =>
  lily({
    exposure: 0.8,
    shadowTone: '--color-lotus-petal-mid',
    pads,
    tierOverrides: {
      sepal: { face: `${kind}-outer` },
      p1: { face: `${kind}-outer` },
      p2: { face: `${kind}-mid` },
      p3: { face: `${kind}-inner` },
      p4: { face: `${kind}-inner` },
    },
  });
/** Teal skirt, white heart. */
const byWhorl = (pads = false) =>
  lily({
    exposure: 0.8,
    shadowTone: '--color-lotus-petal-mid',
    pads,
    tierOverrides: {
      sepal: { face: 'teal-outer' },
      p1: { face: 'teal-outer' },
      p2: { face: 'teal-mid' },
      p3: { face: 'white' },
      p4: { face: 'white' },
    },
  });

const BLENDS: LotusVariant[] = (
  [
    {
      id: 'M1',
      label: 'SVG · teal-tipped whites',
      renderer: 'svg',
      config: blend('tip'),
      look: banded,
    },
    {
      id: 'M1t',
      label: 'Three.js · teal-tipped whites, pads',
      renderer: 'three',
      config: blend('tip', true),
    },
    {
      id: 'M2',
      label: 'SVG · white above, teal beneath',
      renderer: 'svg',
      config: blend('under'),
      look: banded,
    },
    {
      id: 'M2t',
      label: 'Three.js · white above, teal beneath, pads',
      renderer: 'three',
      config: blend('under', true),
    },
    {
      id: 'M3',
      label: 'SVG · half white, half teal',
      renderer: 'svg',
      config: blend('half'),
      look: banded,
    },
    {
      id: 'M3t',
      label: 'Three.js · half white, half teal, pads',
      renderer: 'three',
      config: blend('half', true),
    },
    {
      id: 'M4',
      label: 'SVG · teal outer whorls, white heart',
      renderer: 'svg',
      config: byWhorl(),
      look: banded,
    },
    {
      id: 'M4t',
      label: 'Three.js · teal outer whorls, white heart, pads',
      renderer: 'three',
      config: byWhorl(true),
    },
  ] satisfies LotusVariant[]
).map((v) => ({ ...v, set: 'photo' as const }));

const TEAL: LotusVariant[] = (
  [
    {
      id: 'T1',
      label: 'SVG banded · R9 in the original teals',
      renderer: 'svg',
      config: lilyTeal,
      look: banded,
    },
    { id: 'T2', label: 'Three.js · R9 in the original teals', renderer: 'three', config: lilyTeal },
    {
      id: 'T3',
      label: 'SVG banded + fine outline · original teals',
      renderer: 'svg',
      config: lilyTeal,
      look: { ...banded, outline: true },
    },
    {
      id: 'T4',
      label: 'SVG banded · original teals, warm sepals',
      renderer: 'svg',
      config: lilyTealWarmSepals,
      look: banded,
    },
    {
      id: 'T5',
      label: 'SVG banded · original teals, with pads',
      renderer: 'svg',
      config: lily({
        exposure: 1,
        shadowTone: '--color-lotus-petal-outer',
        tierOverrides: tealTiers,
        pads: true,
      }),
      look: banded,
    },
    {
      id: 'T6',
      label: 'SVG banded + veins · original teals',
      renderer: 'svg',
      config: lilyTeal,
      look: { ...banded, veins: true },
    },
  ] satisfies LotusVariant[]
).map((v) => ({ ...v, set: 'photo' as const }));

const PHOTO: LotusVariant[] = (
  [
    {
      id: 'R1',
      label: 'Three.js · like the photo, with lily pads',
      renderer: 'three',
      config: lily({ pads: true }),
    },
    { id: 'R2', label: 'Three.js · like the photo', renderer: 'three', config: lily() },
    {
      id: 'R3',
      label: 'Three.js · like the photo, pointier',
      renderer: 'three',
      config: lilyPointier,
    },
    {
      id: 'R4',
      label: 'Three.js · like the photo, broader petals',
      renderer: 'three',
      config: lilyBroad,
    },
    { id: 'R5', label: 'Three.js · white with teal tips', renderer: 'three', config: lilyTipped },
    { id: 'R6', label: 'Three.js · C1 teal + stamen crown', renderer: 'three', config: c1Crown },
    {
      id: 'R7',
      label: 'SVG banded · like the photo, with pads',
      renderer: 'svg',
      config: lily({ pads: true }),
      look: { shading: 'strips', veins: false, outline: false },
    },
    {
      id: 'R8',
      label: 'SVG banded + fine outline · like the photo',
      renderer: 'svg',
      config: lily(),
      look: { shading: 'strips', veins: false, outline: true },
    },
    {
      id: 'R9',
      label: 'SVG banded · white with teal tips',
      renderer: 'svg',
      config: lilyTipped,
      look: { shading: 'strips', veins: false, outline: false },
    },
  ] satisfies LotusVariant[]
).map((v) => ({ ...v, set: 'photo' as const }));

const pointed = lotusConfig();
const veryPointed = lotusConfig({ shapeA: 0.8, shapeB: 1.7, widthScale: 1.12 });
const rounded = lotusConfig({ shapeA: 0.62, shapeB: 0.48 });
const specCounts = lotusConfig({
  tierOverrides: { outer: { count: 6 }, mid: { count: 6, phase: 30 }, inner: { count: 5 } },
});
const slenderCup = lotusConfig({
  shapeA: 0.75,
  shapeB: 1.35,
  widthScale: 0.85,
  tierOverrides: {
    outer: { tiltOpen: 66 },
    mid: { tiltOpen: 50 },
    inner: { tiltOpen: 36, length: 0.72 },
  },
});
const wideOpen = lotusConfig({
  tierOverrides: { outer: { tiltOpen: 96 }, mid: { tiltOpen: 82 }, inner: { tiltOpen: 66 } },
});
const manyPetals = lotusConfig({
  shapeB: 1.3,
  widthScale: 0.85,
  tierOverrides: { outer: { count: 11 }, mid: { count: 10, phase: 16 }, inner: { count: 8 } },
});

const strips: Partial<SvgLook> = { shading: 'strips', veins: false, outline: false };

const EARLIER: LotusVariant[] = [
  { id: 'C1', label: 'Three.js · pointed', renderer: 'three', config: pointed },
  { id: 'C2', label: 'Three.js · very pointed', renderer: 'three', config: veryPointed },
  { id: 'C3', label: 'Three.js · many slender petals', renderer: 'three', config: manyPetals },
  { id: 'S1', label: 'SVG · flat · veins + outline', renderer: 'svg', config: pointed },
  {
    id: 'S2',
    label: 'SVG · cupped overlay · veins',
    renderer: 'svg',
    config: pointed,
    look: { shading: 'overlay' },
  },
  {
    id: 'S3',
    label: 'SVG · banded shading · clean',
    renderer: 'svg',
    config: pointed,
    look: strips,
  },
  {
    id: 'S4',
    label: 'SVG · banded · veins + outline',
    renderer: 'svg',
    config: pointed,
    look: { shading: 'strips' },
  },
  {
    id: 'S5',
    label: 'SVG · banded · very pointed',
    renderer: 'svg',
    config: veryPointed,
    look: strips,
  },
  {
    id: 'S6',
    label: 'SVG · banded · many slender petals',
    renderer: 'svg',
    config: manyPetals,
    look: strips,
  },
  {
    id: 'S7',
    label: 'SVG · banded · slender cup',
    renderer: 'svg',
    config: slenderCup,
    look: strips,
  },
  { id: 'S8', label: 'SVG · banded · wide open', renderer: 'svg', config: wideOpen, look: strips },
  {
    id: 'S9',
    label: 'SVG · banded · pale with teal tips',
    renderer: 'svg',
    config: pointed,
    look: { ...strips, palette: 'pale' },
  },
  {
    id: 'S10',
    label: 'SVG · banded · §6.9 counts (6/6/5)',
    renderer: 'svg',
    config: specCounts,
    look: strips,
  },
  {
    id: 'S11',
    label: 'SVG · banded · side-on view',
    renderer: 'svg',
    config: lotusConfig({ elevation: 20 }),
    look: strips,
  },
  {
    id: 'S12',
    label: 'SVG · banded · from above',
    renderer: 'svg',
    config: lotusConfig({ elevation: 58 }),
    look: strips,
  },
  { id: 'S13', label: 'SVG · flat · rounded petals (before)', renderer: 'svg', config: rounded },
];

export const VARIANTS: LotusVariant[] = [
  ...BLENDS,
  ...TEAL,
  ...PHOTO,
  ...EARLIER.map((v) => ({ ...v, set: v.set ?? ('earlier' as const) })),
];
