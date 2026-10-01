/**
 * Make her reachable — `public`, and able to look in her own material (§08 t-54).
 *
 * Until this runs she is `internal` with no capabilities, so Daybreak's role
 * route answers 404 on both of her seats: the facilitation surface refuses any
 * agent that is not `public`. f-voice left both on purpose, for the task that
 * built the way in — the turn seam, which makes a turn idempotent, tags its cost
 * with its seat and records what produced it. That seam lands in the same PR as
 * this unit, and never after it.
 *
 * ## `public` also opens a door that has none of that
 *
 * Sunrise's general consumer chat route serves any `public` agent by slug, and
 * lists her in its agent directory. A turn through it carries no turn id, no
 * seat, no turn record and none of her overlays, and nothing in the leaf can
 * close it: the route consults the authorization seam with no resource, so there
 * is no agent for a policy to refuse. It is recorded on f-safety, which owns
 * ceilings — see `.context/app/agent.md`, "Where else she can be reached".
 *
 * ## The rows this writes, and who owns them (`fp4`)
 *
 * **Visibility is operator-owned.** Widened only while it is still `internal`
 * AND her timeline has no entry of this unit's — so an admin who narrows her
 * again has made a decision, and the next re-run leaves it alone. The widening
 * is an entry in her version timeline, written through the platform's snapshot
 * helpers inside one transaction with the update, as the model pin is.
 *
 * **The grant is filled once.** A binding that does not exist is created; one
 * that exists is left as it is — including disabled, which is an operator's
 * switch. No removal pass. Grants are not in the agent snapshot, so a restore to
 * an earlier version does not take the tool away; that is the platform's model
 * of grants, not a choice made here.
 *
 * **Safe on empty.** A missing agent or a missing capability THROWS, because the
 * runner records a unit as applied the moment `run()` resolves — a quiet return
 * would bank "reachable" for an agent that is not. See `003-voice-fingerprint.ts`.
 *
 * @see lib/app/agent/pins.ts
 * @see lib/app/agent/turns.ts — the turn seam this unit waits for
 * @see .context/app/agent.md
 */

import type { SeedUnit } from '@/prisma/runner';
import { serviceAccountWhere } from '@/lib/auth/account';
import {
  INITIAL_VERSION_SUMMARY,
  asSnapshotJson,
  buildAgentSnapshot,
  nextAgentVersionNumber,
} from '@/lib/orchestration/agents/agent-versioning';
import { GRANTED_CAPABILITY_SLUGS, REACHABLE_CHANGE_SUMMARY } from '@/lib/app/agent/pins';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';

const AGENT_INCLUDE = {
  grantedTags: { select: { tagId: true } },
  grantedDocuments: { select: { documentId: true } },
} as const;

const unit: SeedUnit = {
  name: 'app-lelanea/007-agent-reachable',
  hashInputs: ['../../../lib/app/agent/pins.ts', '../../../lib/app/voice/fingerprint.ts'],
  async run({ prisma, logger }) {
    logger.info('🚪 Making her reachable...');

    const admin = await prisma.user.findFirst({
      where: serviceAccountWhere,
      select: { id: true },
    });
    if (!admin) {
      throw new Error('No service account found — ensure 001-system-owner runs first.');
    }

    const agent = await prisma.aiAgent.findFirst({
      where: { slug: VOICE_AGENT_SLUG, deletedAt: null },
      select: { id: true, visibility: true, createdBy: true },
    });
    if (!agent) {
      logger.error('agent reachable: her agent does not exist — refusing to record success', {
        slug: VOICE_AGENT_SLUG,
      });
      throw new Error(
        `Cannot make ${VOICE_AGENT_SLUG} reachable: no such agent. Unit 003-voice-fingerprint creates it and sorts before this one — check that it ran.`
      );
    }

    // Checked before any write, so a missing one leaves her exactly as she was.
    const capabilities = await prisma.aiCapability.findMany({
      where: { slug: { in: [...GRANTED_CAPABILITY_SLUGS] } },
      select: { id: true, slug: true },
    });
    const missing = GRANTED_CAPABILITY_SLUGS.filter(
      (slug) => !capabilities.some((capability) => capability.slug === slug)
    );
    if (missing.length > 0) {
      throw new Error(
        `Cannot grant ${missing.join(', ')} to ${VOICE_AGENT_SLUG}: no such capability. The platform's own seed units create the built-in capabilities and sort before this one — check that they ran.`
      );
    }

    // ---- The grant ---------------------------------------------------------
    for (const capability of capabilities) {
      const existing = await prisma.aiAgentCapability.findUnique({
        where: { agentId_capabilityId: { agentId: agent.id, capabilityId: capability.id } },
        select: { isEnabled: true },
      });
      if (existing) {
        logger.info(
          existing.isEnabled
            ? `⏭  ${capability.slug} already granted`
            : `⏭  ${capability.slug} is granted and switched off — an operator's switch, left alone`
        );
        continue;
      }
      await prisma.aiAgentCapability.create({
        data: { agentId: agent.id, capabilityId: capability.id },
      });
      logger.info(`🔎 Granted ${capability.slug}`);
    }

    // ---- Visibility --------------------------------------------------------
    const widenedBefore =
      (await prisma.aiAgentVersion.findFirst({
        where: { agentId: agent.id, changeSummary: REACHABLE_CHANGE_SUMMARY },
        select: { version: true },
      })) !== null;

    if (agent.visibility !== 'internal') {
      logger.info(`⏭  ${VOICE_AGENT_SLUG} is already ${agent.visibility}`);
      return;
    }
    if (widenedBefore) {
      logger.warn(
        `${VOICE_AGENT_SLUG} is internal although this seed widened her before — somebody narrowed her since, which is theirs to decide. Left alone; her seats answer 404 until she is public again.`
      );
      return;
    }

    const widened = await prisma.$transaction(async (tx) => {
      // The predicate, not the row read above: an admin's change in between wins.
      const { count } = await tx.aiAgent.updateMany({
        where: { id: agent.id, visibility: 'internal' },
        data: { visibility: 'public' },
      });
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
        await tx.aiAgentVersion.create({
          data: {
            agentId: agent.id,
            version,
            snapshot: asSnapshotJson(
              buildAgentSnapshot({ ...fresh, visibility: 'internal' }, grants)
            ),
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
          changeSummary: REACHABLE_CHANGE_SUMMARY,
          createdBy: admin.id,
        },
      });
      return true;
    });

    logger.info(
      widened
        ? `🌐 ${VOICE_AGENT_SLUG} is public`
        : `⏭  ${VOICE_AGENT_SLUG} changed while this ran — left as it is now`
    );
  },
};

export default unit;
