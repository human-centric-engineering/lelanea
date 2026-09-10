/**
 * Facilitation domain — the versioned map, per-user journey state, the
 * deterministic engine (sole writer of lifecycle state), the advisory guidance layer, and
 * governance.
 *
 * The authored **map** (schema, referential validator, and version service —
 * `f-map`), per-user **journey state** (models + status vocabulary —
 * `f-journey-state` t-1), and the **engine**'s topology layer (`GraphStore` —
 * `f-engine` t-1) are populated below. The rest of the engine (availability, the
 * sole writer of state) and guidance arrive in later features — see
 * `.context/framework/planning/plan.md` (11, 12) and spec §5.
 */
export * from '@/lib/framework/facilitation/map';
export * from '@/lib/framework/facilitation/journey';
export * from '@/lib/framework/facilitation/engine';
