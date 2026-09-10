/**
 * Journey domain — per-user runtime traversal state over an authored map: the
 * `UserJourney` / `UserNodeState` / `JourneyEvent` models (f-journey-state t-1) and,
 * from t-2, the `canRead`-guarded read queries. The deterministic engine that
 * *writes* this state is `f-engine` (feature 11). See spec §5.2 and
 * `.context/framework/planning/f-journey-state.md`.
 *
 * **Two writers, deliberately split.** `createJourney` (`create.ts`, #159) writes the `UserJourney` row and nothing else; `applyEvent` (`f-engine`)
 * remains the sole writer of journey *state* — node projections and the event log.
 * Create the journey, then transition it.
 *
 * The status vocabulary is dependency-free; the read queries (`queries.ts`) and the
 * creation seam (`create.ts`) import `@/lib/db/client`, so per B12 pure/unit tests
 * import the specific module, not this barrel.
 */
export * from '@/lib/framework/facilitation/journey/vocabulary';
export * from '@/lib/framework/facilitation/journey/queries';
export * from '@/lib/framework/facilitation/journey/create';
