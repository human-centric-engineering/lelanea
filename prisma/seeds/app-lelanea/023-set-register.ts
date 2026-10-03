/**
 * The register tool: its row, and the grant to the guide (f-registers t-126).
 *
 * `set_register` is the app's own capability, so it needs what
 * `014-suggest-resource` gives that one: an `ai_capability` row that
 * advertises it, and a binding to `lelanea-guide`. One unit for both, for
 * 014's reason: a row with no grant is a tool nobody holds.
 *
 * Existing databases get the row and the grant from the migration
 * `20261007100200_app_set_register_capability`, which runs first; from then on
 * this unit's `upsert` takes its `update` branch, re-applying the code-owned
 * fields (#545). Its `create` branch is what writes the row on a database
 * whose admin deleted it. The operator-owned literals are pinned equal to the
 * migration's by `set-register-capability.test.ts`.
 *
 * Code-owned fields re-applied; operator-owned fields and the grant written
 * once (`fp4`), exactly as 014. A missing agent throws, for 014's reason.
 *
 * ## After this merges
 * A new tool is dark until each database is reseeded or migrated, and each
 * client reconnects (`sunrise.mcp-reseed`).
 *
 * @see lib/app/voice/register-capability.ts — the handler, and the definition's twin
 * @see lib/app/agent/pins.ts — `REGISTER_CAPABILITY_SLUGS`
 */

import type { SeedUnit } from '@/prisma/runner';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';

const SLUG = 'set_register';

/**
 * The code-owned half of the row. The class in
 * `lib/app/voice/register-capability.ts` carries the identical
 * `functionDefinition`; the test pins them equal.
 */
export const SET_REGISTER_IMPL = {
  executionType: 'internal',
  executionHandler: 'SetRegisterCapability',
  functionDefinition: {
    name: 'set_register',
    description:
      'Call this only when the person asks you to change how you speak with them: gentler or softer ("be gentle with me today", "I can’t take being pushed right now") is guiding; more direct or challenging ("push me", "don’t let me off the hook") is teaching; asking to go back to how it was is default. It holds for the rest of this sitting. Never call it on your own judgement, and never to push someone who is struggling. Then answer them in that register.',
    parameters: {
      type: 'object',
      properties: {
        register: {
          type: 'string',
          enum: ['guiding', 'teaching', 'default'],
          description:
            'guiding (gentle, holding space), teaching (direct, probing), or default (back to how this part of the journey starts).',
        },
      },
      required: ['register'],
    },
  },
};

const unit: SeedUnit = {
  name: 'app-lelanea/023-set-register',
  hashInputs: ['../../../lib/app/voice/register-capability.ts', '../../../lib/app/agent/pins.ts'],
  async run({ prisma, logger }) {
    logger.info('🎚  Giving the guide the register a person asks for...');

    const capability = await prisma.aiCapability.upsert({
      where: { slug: SLUG },
      update: { isSystem: true, ...SET_REGISTER_IMPL },
      create: {
        slug: SLUG,
        name: 'Change how it speaks',
        description:
          'Remembers, for a sitting, that the person asked to be met more gently or more directly. Writes only their own lean on their own journey.',
        category: 'app',
        rateLimit: 10,
        isActive: true,
        isSystem: true,
        ...SET_REGISTER_IMPL,
      },
      select: { id: true },
    });

    const agent = await prisma.aiAgent.findFirst({
      where: { slug: VOICE_AGENT_SLUG, deletedAt: null },
      select: { id: true },
    });
    if (!agent) {
      throw new Error(
        `Cannot grant ${SLUG} to ${VOICE_AGENT_SLUG}: no such agent. Unit 003-voice-fingerprint creates the guide and sorts before this one — check that it ran.`
      );
    }

    const existing = await prisma.aiAgentCapability.findUnique({
      where: { agentId_capabilityId: { agentId: agent.id, capabilityId: capability.id } },
      select: { isEnabled: true },
    });
    if (existing) {
      logger.info(
        existing.isEnabled
          ? `⏭  ${SLUG} already granted — left alone`
          : `⏭  ${SLUG} is granted and switched off — an operator's switch, left alone`
      );
      return;
    }
    await prisma.aiAgentCapability.create({
      data: { agentId: agent.id, capabilityId: capability.id },
    });
    logger.info(`🧬 Granted ${SLUG} — the guide may remember how a person asked to be met`);
  },
};

export default unit;
