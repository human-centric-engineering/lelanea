/**
 * Journey domain — per-user runtime traversal state over an authored map: the
 * `UserJourney` / `UserNodeState` / `JourneyEvent` models (f-journey-state t-1) and,
 * from t-2, the `canRead`-guarded read queries. The deterministic engine that
 * *writes* this state is `f-engine` (feature 11). See spec §5.2 and
 * `.context/framework/planning/f-journey-state.md`.
 *
 * **Three writers, deliberately split — by field, not by table.** `createJourney`
 * (`create.ts`, #159) writes the `UserJourney` row and nothing else.
 * `recordNodeProgress` (`progress.ts`, #168) writes the module-owned
 * `UserNodeState.progress` payload and nothing else — the column the schema declares
 * opaque to the engine, so writing it is not an engine concern. `applyEvent`
 * (`f-engine`) remains the sole writer of journey *lifecycle* state: node `status`,
 * `timesCompleted`, the timestamps, and the event log. Create the journey, transition
 * it, and record a module's own facts against the nodes it has reached.
 *
 * The status vocabulary is dependency-free; the read queries (`queries.ts`), the
 * creation seam (`create.ts`) and the progress seam (`progress.ts`) import
 * `@/lib/db/client`, so per B12 pure/unit tests
 * import the specific module, not this barrel.
 */
export * from '@/lib/framework/facilitation/journey/vocabulary';
export * from '@/lib/framework/facilitation/journey/queries';
export * from '@/lib/framework/facilitation/journey/create';
export * from '@/lib/framework/facilitation/journey/progress';
