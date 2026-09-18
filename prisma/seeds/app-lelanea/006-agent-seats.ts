/**
 * Seat her — the `facilitator` and `onboarding` seats, bound to her agent.
 *
 * Before this runs no facilitation seat in this install is bound to anyone.
 * Daybreak ships the six seats and the binding mechanism and deliberately leaves
 * filling them to the leaf, so its role route answers 404 for every role: there
 * is nobody to talk to. This unit puts her in the two seats a person meets her
 * through — the first-contact seat and the facilitator's.
 *
 * ## The rows this writes, and who owns them (`fp4`)
 *
 * **A code projection limited to the two seats in `SEATED_ROLES`.** The other four
 * seats are not this unit's and it never reads or writes them.
 *
 * Within its two, it only ever fills an EMPTY seat. `@@unique([role])` means a
 * seat holds one agent, and reassigning one is an unbind plus a rebind — so a
 * seat already held by another agent is a binding this seed did not create, made
 * by an operator on purpose. It is reported and left alone. Taking it back would
 * mean deleting their row, and a seed that undoes an admin's decision on its next
 * run is one nobody can safely re-run.
 *
 * **No removal pass.** Dropping a role from `SEATED_ROLES` stops this unit
 * filling that seat; it does not free it.
 *
 * **Known limit: an emptied seat is refilled.** A seat left empty on purpose is
 * indistinguishable, from here, from one never filled — telling them apart would
 * mean reading the admin audit log for an unbind, and coupling a seed to it. So an
 * admin who unbinds her and leaves the seat empty is re-seated the next time this
 * unit re-runs. The way to keep her out of a seat is to take the role out of
 * `SEATED_ROLES`. Found by /code-review; documented rather than built.
 *
 * **Idempotent, no timestamp churn.** A seat she already holds is not written.
 *
 * **Safe on empty.** A missing agent THROWS rather than returning, because
 * `prisma/runner.ts` records a unit as applied the moment `run()` resolves — a
 * quiet return would bank "seated nobody" as a success and every later `db:seed`
 * would skip it. See `003-voice-fingerprint.ts`.
 *
 * ## Binding her while she is still `internal` is harmless, and deliberate
 *
 * Her agent's visibility is still the platform default and she holds no
 * capabilities, so the role route keeps answering 404 after this runs. Widening
 * her is NOT done here: it also opens Sunrise's general consumer chat route,
 * which has no turn id, no seat and no record of what produced a turn. Both land
 * with the turn seam (§08 t-54), not before it.
 *
 * ## No framework sync, on purpose
 *
 * `001-journey-map.ts` calls `syncFrameworkForSeed` because a map points at
 * `Module` rows that only boot materialises. A seat binding points at nothing of
 * the kind: the role is checked against `FACILITATION_ROLES`, a constant in
 * code, and the only row it needs is her agent. The first version of this unit
 * made the call anyway, as insurance against a validation that does not exist —
 * which bought a full framework reconcile on every run, and meant a failure in
 * that unrelated sync failed the seating. Caught by /code-review.
 *
 * @see lib/app/agent/pins.ts
 * @see lib/framework/facilitation/agents/binding-service.ts
 * @see .context/app/agent.md
 */

import type { SeedUnit } from '@/prisma/runner';
import { serviceAccountWhere } from '@/lib/auth/account';
import { bindFacilitationAgent } from '@/lib/framework/facilitation/agents/binding-service';
import { getFacilitationBindingByRole } from '@/lib/framework/facilitation/agents/binding-queries';
import { SEATED_ROLES } from '@/lib/app/agent/pins';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';

const unit: SeedUnit = {
  name: 'app-lelanea/006-agent-seats',
  // `pins.ts` names the seats, `roles.ts` is the vocabulary they are drawn from,
  // and `fingerprint.ts` owns her slug. Relative to this file, as the runner
  // requires.
  hashInputs: [
    '../../../lib/app/agent/pins.ts',
    '../../../lib/app/voice/fingerprint.ts',
    '../../../lib/framework/facilitation/agents/roles.ts',
  ],
  async run({ prisma, logger }) {
    logger.info('🪑 Seating her...');

    const admin = await prisma.user.findFirst({
      where: serviceAccountWhere,
      select: { id: true },
    });
    if (!admin) {
      throw new Error('No service account found — ensure 001-system-owner runs first.');
    }

    const agent = await prisma.aiAgent.findFirst({
      where: { slug: VOICE_AGENT_SLUG, deletedAt: null },
      select: { id: true },
    });
    if (!agent) {
      // THROW, not return — see the header.
      logger.error('agent seats: her agent does not exist — refusing to record success', {
        slug: VOICE_AGENT_SLUG,
      });
      throw new Error(
        `Cannot seat ${VOICE_AGENT_SLUG}: no such agent. Unit 003-voice-fingerprint creates it and sorts before this one — check that it ran.`
      );
    }

    for (const role of SEATED_ROLES) {
      const existing = await getFacilitationBindingByRole(role);

      if (!existing) {
        await bindFacilitationAgent({ agentId: agent.id, role, userId: admin.id });
        logger.info(`✓ ${VOICE_AGENT_SLUG} bound to the "${role}" seat`);
        continue;
      }

      if (existing.agentId === agent.id) {
        logger.info(`⏭  "${role}" seat already hers`);
        continue;
      }

      logger.warn(
        `The "${role}" seat is held by another agent. This seed fills empty seats only and did not create that binding, so it is left alone — unbind it in the admin if she should have the seat.`,
        { role, heldBy: existing.agent?.slug ?? existing.agentId }
      );
    }
  },
};

export default unit;
