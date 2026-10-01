/**
 * Let members speak to her — `enableVoiceInput` on, once (§10 t-67).
 *
 * Her agent is created with the platform's default, voice input off, so the
 * member transcribe route refuses and the composer's microphone is not
 * offered. This turns it on for `lelanea-guide`, the way `007-agent-reachable`
 * widens her, and never again.
 *
 * ## The row this writes, and who owns it (`fp4`)
 *
 * **The flag is operator-owned.** Switched on only while it is still off AND
 * her timeline has no entry of this unit's — off with that entry behind it is
 * an admin who turned it off, which a re-run must leave alone. The switch is an
 * entry in her version timeline (the flag is a versioned field), written
 * through the platform's snapshot helpers inside one transaction with the
 * update, as the model pin and the widening are.
 *
 * The org-wide `voiceInputGloballyEnabled` is not touched: it is an operator's
 * off switch and defaults on.
 *
 * **Safe on empty.** A missing agent THROWS — the runner records a unit as
 * applied the moment `run()` resolves, and a quiet return would bank "on" for
 * an agent that is not there.
 *
 * @see lib/app/agent/voice-input.ts
 * @see .context/app/conversation.md — "The microphone"
 */

import type { SeedUnit } from '@/prisma/runner';
import { serviceAccountWhere } from '@/lib/auth/account';
import {
  INITIAL_VERSION_SUMMARY,
  asSnapshotJson,
  buildAgentSnapshot,
  nextAgentVersionNumber,
} from '@/lib/orchestration/agents/agent-versioning';
import { VOICE_INPUT_CHANGE_SUMMARY } from '@/lib/app/agent/pins';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';

const AGENT_INCLUDE = {
  grantedTags: { select: { tagId: true } },
  grantedDocuments: { select: { documentId: true } },
} as const;

const unit: SeedUnit = {
  name: 'app-lelanea/012-agent-voice-input',
  hashInputs: ['../../../lib/app/agent/pins.ts', '../../../lib/app/voice/fingerprint.ts'],
  async run({ prisma, logger }) {
    logger.info('🎙  Letting members speak to her...');

    const admin = await prisma.user.findFirst({
      where: serviceAccountWhere,
      select: { id: true },
    });
    if (!admin) {
      throw new Error('No service account found — ensure 001-system-owner runs first.');
    }

    const agent = await prisma.aiAgent.findFirst({
      where: { slug: VOICE_AGENT_SLUG, deletedAt: null },
      select: { id: true, enableVoiceInput: true, createdBy: true },
    });
    if (!agent) {
      logger.error('agent voice input: her agent does not exist — refusing to record success', {
        slug: VOICE_AGENT_SLUG,
      });
      throw new Error(
        `Cannot switch voice input on for ${VOICE_AGENT_SLUG}: no such agent. Unit 003-voice-fingerprint creates it and sorts before this one — check that it ran.`
      );
    }

    const switchedBefore =
      (await prisma.aiAgentVersion.findFirst({
        where: { agentId: agent.id, changeSummary: VOICE_INPUT_CHANGE_SUMMARY },
        select: { version: true },
      })) !== null;

    if (agent.enableVoiceInput) {
      logger.info(`⏭  ${VOICE_AGENT_SLUG} already accepts voice input`);
      return;
    }
    if (switchedBefore) {
      logger.warn(
        `${VOICE_AGENT_SLUG} has voice input off although this seed switched it on before — somebody turned it off since, which is theirs to decide. Left alone; the microphone is not offered until it is on again.`
      );
      return;
    }

    const switched = await prisma.$transaction(async (tx) => {
      // The predicate, not the row read above: an admin's change in between wins.
      const { count } = await tx.aiAgent.updateMany({
        where: { id: agent.id, enableVoiceInput: false },
        data: { enableVoiceInput: true },
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
              buildAgentSnapshot({ ...fresh, enableVoiceInput: false }, grants)
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
          changeSummary: VOICE_INPUT_CHANGE_SUMMARY,
          createdBy: admin.id,
        },
      });
      return true;
    });

    logger.info(
      switched
        ? `🎙  ${VOICE_AGENT_SLUG} accepts voice input`
        : `⏭  ${VOICE_AGENT_SLUG} changed while this ran — left as it is now`
    );
  },
};

export default unit;
