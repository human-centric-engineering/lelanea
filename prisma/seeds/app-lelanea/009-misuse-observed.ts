/**
 * Attempts on her are seen, and never turn into a fake outage (f-safety t-60).
 *
 * Two things, both about the platform's inline guards on her seats:
 *
 * 1. **Her guards observe; they never block.** `inputGuardMode` and
 *    `outputGuardMode` on her agent are set to `log_only` (`GUARD_MODES`). A
 *    blocked turn reaches the person as the neutral `unavailable` ending, which
 *    for a heuristic false positive means "she is down" when she is not. The
 *    agent's column wins over the install default, which is why it is written
 *    onto her.
 * 2. **A detection reaches a person.** One Daybreak `escalation` policy per seat
 *    (`ESCALATION_POLICIES`): an input-guard detection notifies a reviewer and
 *    writes an audit entry.
 *
 * ## Who owns the rows (`fp4`)
 *
 * **Both are operator-owned.** A guard mode is written only while the column is
 * still NULL, meaning nobody has chosen one. An admin who sets `block` has made a
 * decision; the unit logs it and leaves it alone, and the misuse smoke reports
 * it. A policy is created only when no escalation policy exists for that seat
 * and guard, whether enabled or not. One an operator switched off stays off,
 * and one they edited is never rewritten. No removal pass.
 *
 * The guard-mode write is an entry in her version timeline (both columns are
 * versioned fields), written in one transaction with the update, as the model
 * pin and the widening are.
 *
 * **Idempotent.** Every write is preceded by a read that makes it unnecessary
 * on a re-run.
 *
 * **Safe on empty.** A missing agent THROWS: the runner banks a unit as applied
 * the moment `run()` resolves, so a quiet return would record "guards set" for
 * an agent that does not exist.
 *
 * @see lib/app/agent/pins.ts — `GUARD_MODES`, `ESCALATION_POLICIES`
 * @see lib/app/safety/misuse.ts — the other observer, the safety record
 * @see lib/framework/facilitation/policies/escalation.ts — what the policy drives
 */

import type { Prisma } from '@prisma/client';

import type { SeedUnit } from '@/prisma/runner';
import { serviceAccountWhere } from '@/lib/auth/account';
import {
  INITIAL_VERSION_SUMMARY,
  asSnapshotJson,
  buildAgentSnapshot,
  nextAgentVersionNumber,
} from '@/lib/orchestration/agents/agent-versioning';
import { assertValidFacilitationPolicy } from '@/lib/framework/facilitation/policies/kinds';
import { coveredEscalations, escalationKey } from '@/lib/app/safety/escalation';
import { ESCALATION_POLICIES, GUARD_MODES, GUARD_MODES_CHANGE_SUMMARY } from '@/lib/app/agent/pins';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';

const AGENT_INCLUDE = {
  grantedTags: { select: { tagId: true } },
  grantedDocuments: { select: { documentId: true } },
} as const;

const GUARD_FIELDS = ['inputGuardMode', 'outputGuardMode'] as const satisfies ReadonlyArray<
  keyof typeof GUARD_MODES
>;

const unit: SeedUnit = {
  name: 'app-lelanea/009-misuse-observed',
  hashInputs: ['../../../lib/app/agent/pins.ts'],
  async run({ prisma, logger }) {
    const admin = await prisma.user.findFirst({
      where: serviceAccountWhere,
      select: { id: true },
    });
    if (!admin) {
      throw new Error('No service account found — ensure 001-system-owner runs first.');
    }

    const agent = await prisma.aiAgent.findFirst({
      where: { slug: VOICE_AGENT_SLUG, deletedAt: null },
      select: { id: true, createdBy: true, inputGuardMode: true, outputGuardMode: true },
    });
    if (!agent) {
      logger.error('misuse observed: her agent does not exist — refusing to record success', {
        slug: VOICE_AGENT_SLUG,
      });
      throw new Error(
        `Cannot set ${VOICE_AGENT_SLUG}'s guards: no such agent. Unit 003-voice-fingerprint creates it and sorts before this one — check that it ran.`
      );
    }

    // ---- Guard modes: filled while unchosen, never overwritten ---------------
    const unset = GUARD_FIELDS.filter((field) => agent[field] === null);
    const chosen = GUARD_FIELDS.filter(
      (field) => agent[field] !== null && agent[field] !== GUARD_MODES[field]
    );
    for (const field of chosen) {
      logger.warn(
        `${VOICE_AGENT_SLUG}'s ${field} is "${agent[field]}", not "${GUARD_MODES[field]}" — an operator's choice, left alone. A heuristic hit on her seats will now end the turn with the "unavailable" ending.`
      );
    }

    if (unset.length === 0) {
      logger.info(`⏭  ${VOICE_AGENT_SLUG}'s guard modes are already set`);
    } else {
      const written = await prisma.$transaction(async (tx) => {
        const data: Prisma.AiAgentUpdateManyMutationInput = {};
        const where: Prisma.AiAgentWhereInput = { id: agent.id };
        for (const field of unset) {
          data[field] = GUARD_MODES[field];
          // The predicate, not the row read above: an admin's change in between wins.
          where[field] = null;
        }
        const { count } = await tx.aiAgent.updateMany({ where, data });
        if (count === 0) return false;

        const { grantedTags, grantedDocuments, ...fresh } = await tx.aiAgent.findUniqueOrThrow({
          where: { id: agent.id },
          include: AGENT_INCLUDE,
        });
        const grants = {
          grantedTagIds: grantedTags.map((grant) => grant.tagId),
          grantedDocumentIds: grantedDocuments.map((grant) => grant.documentId),
        };

        let version = await nextAgentVersionNumber(tx, agent.id);
        if (version === 1) {
          const before = Object.fromEntries(unset.map((field) => [field, null]));
          await tx.aiAgentVersion.create({
            data: {
              agentId: agent.id,
              version,
              snapshot: asSnapshotJson(buildAgentSnapshot({ ...fresh, ...before }, grants)),
              changeSummary: INITIAL_VERSION_SUMMARY,
              createdBy: agent.createdBy ?? admin.id,
            },
          });
          version += 1;
        }
        await tx.aiAgentVersion.create({
          data: {
            agentId: agent.id,
            version,
            snapshot: asSnapshotJson(buildAgentSnapshot(fresh, grants)),
            changeSummary: GUARD_MODES_CHANGE_SUMMARY,
            createdBy: admin.id,
          },
        });
        return true;
      });
      logger.info(
        written
          ? `👁  ${VOICE_AGENT_SLUG}'s guards observe (${unset.join(', ')} → log_only)`
          : `⏭  ${VOICE_AGENT_SLUG} changed while this ran — left as it is now`
      );
    }

    // ---- Escalation policies: created once per seat, never rewritten --------
    const existing = await prisma.facilitationPolicy.findMany({
      where: { kind: 'escalation' },
      select: { payload: true },
    });
    const covered = coveredEscalations(existing.map((row) => row.payload));

    for (const payload of ESCALATION_POLICIES) {
      if (covered.has(escalationKey(payload.scope.id, payload.signal.guard))) {
        logger.info(
          `⏭  an ${payload.signal.guard}-guard escalation already covers ${payload.scope.id}`
        );
        continue;
      }
      // Validated through the framework's own schema, so a payload the admin
      // surface would refuse can never be seeded.
      const valid = assertValidFacilitationPolicy('escalation', payload);
      await prisma.facilitationPolicy.create({
        data: {
          kind: valid.kind,
          payload: valid.payload,
          createdBy: admin.id,
        },
      });
      logger.info(
        `🚨 Escalation on ${payload.scope.id}: ${payload.signal.guard} guard flagged → notify + audit`
      );
    }
  },
};

export default unit;
