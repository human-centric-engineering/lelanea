/**
 * The framework's single read-access seam (f-journey-state t-2).
 *
 * Every journey read — and, by documented convention, every slot read — routes
 * through `canRead(viewer, subject, scope)`. Concentrating the "may this viewer
 * see this subject's data?" decision in one function is what turns §8's
 * relational / cohort features into a later policy change *inside this function*
 * instead of a codebase-wide sweep of `where userId` (convention X2 — "the access
 * discipline from day one"). Its list/analytics face is {@link subjectScope}: the
 * same predicate expressed as a Prisma `where` fragment ("which subjects may this
 * viewer see?").
 *
 * **Async from day one (decision 7).** Today's body is synchronous in spirit
 * (`viewer === subject`, an admin-support override, default-deny), but §8's
 * `JourneyLink` grants need a DB lookup, so the signature is `Promise`-returning
 * now to avoid a later sync→async sweep of every caller — the exact churn X2 exists
 * to prevent.
 *
 * **Composes with Sunrise #366 (tier) / #367 (ownership), does not fork them.**
 * The `scope` argument is an *open structured value* carrying #367's ownership
 * input (`own | team | all`) and #366's tier input. When #367's ownership resolver
 * lands upstream, `canRead` **delegates to it** (supplying `scope` as the input)
 * rather than growing a framework-private parallel check; until then it mirrors the
 * one-predicate-three-inputs contract. #366/#367 are verified *not landed* as of
 * 2026-07-04 (no ownership resolver in `lib/auth/`).
 *
 * Lives in `shared/` (next to `scope.ts`), not the facilitation domain, because it
 * guards **both** journey reads *and* slot reads — cross-domain framework
 * infrastructure, not facilitation-private (decision 8). It is dependency-free and
 * boundary-clean: `viewer` is a framework-local shape (below), bridged to the
 * core session-user by structure, never by importing a core auth type — the same
 * way `scope.ts` bridges to core's generic scope map by shape.
 *
 * **The slot-read guarding path (documented, not rewired).** `getSlotHeads`
 * (`data-slots/values.ts`) stays the raw engine `f-slots` shipped — it takes a
 * bare `userId` and its doc comment records that "access scoping (`canRead`) wraps
 * this later". This feature *provides* that wrapper rather than editing the shipped
 * engine: the slot-reading consumers — `f-slot-capture`'s `get_state` capability
 * (10) and `f-guidance` (12) — call `canRead(viewer, subject, scope)` (or `AND`
 * `subjectScope` into a batch read) **before** `getSlotHeads(subject)`, supplying
 * the `subject` seam the engine left open. Journey reads (`journey/queries.ts`)
 * enforce this in-module today; slot reads inherit the same predicate at their
 * (not-yet-built) call sites. This note is the contract those plans reference.
 */

/** A framework `own | team | all` ownership input (mirrors Sunrise #367). */
export type Ownership = 'own' | 'team' | 'all';

/**
 * The open, structured access scope carried through the predicate. Both members
 * are optional; the empty scope `{}` is "the default, own-data view". Additional
 * inputs (#366 tier, future cohort keys) widen this without changing the
 * predicate's signature — that openness is the point (decision 7).
 */
export interface AccessScope {
  /** #367 ownership input. Absent ⇒ treated as `'own'` (default-deny widening). */
  ownership?: Ownership;
  /** #366 tier input, carried opaquely for the upstream resolver. */
  tier?: string;
}

/**
 * The minimal viewer shape this seam needs — a framework-local interface bridged
 * to the core session-user (`AuthSession['user']`) by structure, so the boundary
 * stays clean (no core import). A caller passes `{ userId }` from the session.
 *
 * `isAdminSupport` is an **explicit, narrow** support-tooling flag the caller sets
 * deliberately for admin support surfaces — *not* a bare `role === 'ADMIN'` check
 * read off the session here. Keeping the override an explicit input keeps it
 * auditable ("this call site opted into cross-user support access") and keeps this
 * module free of role vocabulary.
 */
export interface JourneyViewer {
  /** The viewing user's id (`user.id` from the session). */
  userId: string;
  /** Explicit admin support-tooling override — set only by support surfaces. */
  isAdminSupport?: boolean;
}

/**
 * A Prisma `where` fragment selecting the subjects a viewer may read. `{ userId }`
 * narrows to one subject; `{}` (no `userId` key) is "every subject" — so widening
 * `own → all` later is *dropping* the key, not rewriting the callers that `AND`
 * this into their queries.
 */
export interface SubjectFilter {
  userId?: string;
}

/**
 * May `viewer` read `subject`'s journey/slot data under `scope`? Default-deny.
 *
 * Today: allow when the viewer *is* the subject, or when the viewer holds the
 * explicit admin support-tooling override; deny everything else. `scope` is
 * carried for the #367 resolver to consume but is **not branched on** for
 * unmodelled inputs today (single-user Lelanea exercises only `own`) — see the
 * module header for the delegation path.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- async from day one (decision 7): delegates to #367's async ownership resolver once it lands, so the signature is Promise-returning now to avoid a later sync→async caller sweep.
export async function canRead(
  viewer: JourneyViewer,
  subject: string,
  scope: AccessScope = {}
): Promise<boolean> {
  // Own data is always readable.
  if (viewer.userId === subject) return true;
  // Admin support-tooling: an explicit, narrow override the caller opted into.
  if (viewer.isAdminSupport) return true;
  // `scope` (ownership `own|team|all` + tier) is carried for the upstream #367
  // resolver; no cross-user grant is modelled here yet, so anything else denies.
  // When #367 lands this becomes `return ownershipResolver.canRead(viewer, subject, scope)`.
  void scope;
  return false;
}

/**
 * May `viewer` **write** `subject`'s journey data under `scope`? Default-deny.
 *
 * Today this is value-identical to {@link canRead} — self, or the explicit
 * admin-support override. It exists anyway, and the duplication is the point.
 *
 * **Why a separate predicate.** `canRead` is documented above as delegating to
 * Sunrise #367's ownership resolver when it lands, widening `own → team → all`.
 * That widening is about **reading**: the `f-ops-views` analytics and coach scopes
 * exist so someone can see a cohort's journeys. If creation guarded on `canRead`,
 * the day that resolver is wired every viewer who could merely *read* a cohort
 * would silently gain the right to *create* `framework_user_journey` rows for
 * those subjects — with no diff to the write path and no test in the suite
 * failing. A capability should widen because someone decided to widen it, not by
 * omission.
 *
 * So the write grant is **pinned** here to the narrow set, and widening it is a
 * deliberate edit to this function that a reviewer will see.
 *
 * **It composes rather than replaces:** a write requires `canRead` to pass *and*
 * the pinned grant. That ordering matters in the other direction — if #367 ever
 * makes `canRead` **narrower** for a subject (a tenancy deny, say), the write is
 * refused too, instead of a stale write grant outliving the read it depends on.
 *
 * **Every journey write that takes a VIEWER routes through here** (#242 closed the
 * last gap): `createJourney` (#159), `recordNodeProgress` (#168) and
 * `applyJourneyTransition` (`f-guidance`). The last of those needs `canRead` as
 * well — it cannot validate a transition without loading the subject's graph, node
 * states and slots — so it holds both guards rather than swapping one for the
 * other.
 *
 * **"Takes a viewer" is the whole of the claim.** It is NOT "every writer of the
 * journey tables", and the difference is not cosmetic: the unguarded writers are
 * barrel-exported, so a leaf reaches them by import.
 *
 *   - `applyEvent` (`facilitation/engine/apply-event.ts`, re-exported through
 *     `@/lib/framework/facilitation`) is the sole writer of BOTH `UserNodeState`
 *     and `JourneyEvent`, and takes `transition.userId` as a plain argument. It is
 *     unguarded **by design** — F11 makes it a pure engine whose read context is
 *     the caller's — so the predicate belongs at its caller, which today is only
 *     `applyJourneyTransition`. A leaf calling it directly supplies its own
 *     subject and nothing checks it.
 *   - `recordModuleEngagement` (`engagement/record-engagement.ts`) writes
 *     `JourneyEvent` and takes a bare `userId`. It cannot hold a guard as it
 *     stands: it is contractually non-throwing (fire-and-forget from a request
 *     path), so a refusal has nowhere to go.
 *
 * Both are safe today because every in-repo caller binds the subject to someone
 * already authorized — the authenticated actor, or (in `module-completion.ts`) the
 * journey subject threaded down from a call that passed this predicate. That is a
 * property of the call sites, not of the seams, and it is not enforced. Filed as
 * #251. Deliberately stated as a rule rather than a list of callers: an earlier
 * version of this note counted them, and the count was wrong within a day.
 *
 * A future write that DOES take a viewer must guard here. Nothing enforces that
 * mechanically; `tests/unit/lib/framework/shared/access.test.ts` pins what the
 * predicate DOES, not who remembers to call it.
 */
export async function canWrite(
  viewer: JourneyViewer,
  subject: string,
  scope: AccessScope = {}
): Promise<boolean> {
  // A write requires the read (see "composes rather than replaces" above).
  if (!(await canRead(viewer, subject, scope))) return false;
  // …plus the pinned narrow grant, which #367's widening deliberately cannot reach.
  return viewer.userId === subject || viewer.isAdminSupport === true;
}

/**
 * The list/analytics face of {@link canRead}: the Prisma `where` fragment naming
 * the subjects `viewer` may see under `scope`. `f-ops-views` (15) `AND`s this into
 * its journey aggregations so analytics inherits the same access discipline as the
 * single-row reads — one seam, two shapes.
 *
 * Its admin-support behaviour mirrors {@link canRead} exactly, so the row-level
 * decision and the list-level filter agree: an admin-support viewer sees every
 * subject (`{}`) — the set form of `canRead` granting that viewer any single
 * subject — and every other viewer sees only their own rows (`{ userId }`), the
 * set form of `canRead` allowing only self. `scope`'s `own → team → all` widening
 * for a *non-support* viewer delegates to #367 when it lands (branched on there,
 * not here — same as `canRead`); until then a non-support viewer never broadens
 * past their own rows.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- async from day one (decision 7): the same seam as canRead, Promise-returning now so #367's resolver widens `own→team→all` without a caller sweep.
export async function subjectScope(
  viewer: JourneyViewer,
  scope: AccessScope = {}
): Promise<SubjectFilter> {
  // Admin support-tooling sees every subject — the set form of canRead's admin
  // grant, so the two faces of the seam agree.
  if (viewer.isAdminSupport) return {};
  // Everyone else: their own rows only. `scope`'s `team`/`all` widening for a
  // non-support viewer delegates to #367 (not branched on here yet, as in canRead).
  void scope;
  return { userId: viewer.userId };
}

/**
 * Build the viewer an **admin support surface** passes to the journey/slot reads:
 * the operator's own `userId` plus the explicit `isAdminSupport` override that lets
 * them read *other* users' data. This is the one sanctioned construction of that
 * override — it exists so support routes opt in through a single named place (next
 * to the {@link JourneyViewer} note above) rather than each hand-rolling
 * `{ userId, isAdminSupport: true }` or, worse, deriving the flag from a bare
 * `role === 'ADMIN'` read. Every framework admin support route (`f-ops-views` journey
 * explorer today; more later) uses this so the grant stays auditable and drift-free.
 */
export function adminSupportViewer(userId: string): JourneyViewer {
  return { userId, isAdminSupport: true };
}
