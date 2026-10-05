/**
 * The leaning tool: its row, and the grant to the guide (f-leanings t-137).
 *
 * `set_leaning` is the app's own capability, so it needs what `023-set-register`
 * gives that one: an `ai_capability` row that advertises it, and a binding to
 * `lelanea-guide`. One unit for both, for 014's reason: a row with no grant is
 * a tool nobody holds.
 *
 * Existing databases get the row and the grant from the migration
 * `20261012100000_app_set_leaning_capability`, which runs first; from then on
 * this unit's `upsert` takes its `update` branch, re-applying the code-owned
 * fields (#545). Its `create` branch is what writes the row on a database
 * whose admin deleted it. The operator-owned literals are pinned equal to the
 * migration's by `set-leaning-capability.test.ts`.
 *
 * Code-owned fields re-applied; operator-owned fields and the grant written
 * once (`fp4`), exactly as 014. A missing agent throws, for 014's reason.
 *
 * ## After this merges
 * A new tool is dark until each database is reseeded or migrated, and each
 * client reconnects (`sunrise.mcp-reseed`).
 *
 * @see lib/app/voice/leaning-capability.ts — the handler, and the definition's twin
 * @see lib/app/agent/pins.ts — `LEANING_CAPABILITY_SLUGS`
 */

import type { SeedUnit } from '@/prisma/runner';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';

const SLUG = 'set_leaning';

/**
 * The code-owned half of the row. The class in
 * `lib/app/voice/leaning-capability.ts` carries the identical
 * `functionDefinition`; the test pins them equal.
 */
export const SET_LEANING_IMPL = {
  executionType: 'internal',
  executionHandler: 'SetLeaningCapability',
  functionDefinition: {
    name: 'set_leaning',
    description:
      'Change one of the person’s lasting leanings: how your voice leans for them from now on, the same dials they have in Settings. Two ways, and only these. (1) They ask in their own words for a lasting change ("be plainer with me", "you can be more direct with me"): call it then, with how: asked. (2) You notice a pattern they have not named: call it with how: proposed, which changes nothing and only records the proposal, and put it to them in one sentence: what you noticed, and what you would change. Then wait. Only if they say yes in their next message, call it again with how: agreed, the same leaning and the same pole. Never change a leaning on your own inference. Each call moves one leaning one stop toward a pole, or back to rest. This is not set_register: "be gentle with me today" is today’s lean, and that is set_register; a lasting setting is this. Then answer them as they asked.',
    parameters: {
      type: 'object',
      properties: {
        leaning: {
          type: 'string',
          enum: [
            'abstraction',
            'devotion',
            'directness',
            'encouragement',
            'length',
            'warmth',
            'pace',
            'questions',
            'imagery',
            'playfulness',
            'formality',
          ],
          description:
            'Which leaning, with its two poles: abstraction (Philosophical ↔ Grounded and practical); devotion (Spiritual and devotional ↔ Secular and plain); directness (Gentle ↔ Direct, and further, challenging); encouragement (Encouraging ↔ Neutral and unsentimental); length (Verbose and exploratory ↔ Concise and spare); warmth (Empathetic and warm ↔ Cool and analytical); pace (Energetic ↔ Slow and spacious); questions (Question-led ↔ Guidance-led); imagery (Story and metaphor ↔ Literal); playfulness (Playful ↔ Serious); formality (Formal ↔ Familiar).',
        },
        toward: {
          type: 'string',
          enum: [
            'Philosophical',
            'Grounded and practical',
            'Spiritual and devotional',
            'Secular and plain',
            'Gentle',
            'Direct, and further, challenging',
            'Encouraging',
            'Neutral and unsentimental',
            'Verbose and exploratory',
            'Concise and spare',
            'Empathetic and warm',
            'Cool and analytical',
            'Energetic',
            'Slow and spacious',
            'Question-led',
            'Guidance-led',
            'Story and metaphor',
            'Literal',
            'Playful',
            'Serious',
            'Formal',
            'Familiar',
            'rest',
          ],
          description:
            'One of the two poles of that leaning, exactly as written there, to move it one stop toward that pole; or rest, to put it back to her voice unshaded.',
        },
        how: {
          type: 'string',
          enum: ['asked', 'proposed', 'agreed'],
          description:
            'asked: they asked for this change themselves, without you suggesting it. proposed: you are suggesting it; nothing changes. agreed: you proposed it in your last reply, and they have just said yes.',
        },
      },
      required: ['leaning', 'toward', 'how'],
    },
  },
};

const unit: SeedUnit = {
  name: 'app-lelanea/025-set-leaning',
  hashInputs: ['../../../lib/app/voice/leaning-capability.ts', '../../../lib/app/agent/pins.ts'],
  async run({ prisma, logger }) {
    logger.info('🎚  Giving the guide the leanings a person asks for...');

    const capability = await prisma.aiCapability.upsert({
      where: { slug: SLUG },
      update: { isSystem: true, ...SET_LEANING_IMPL },
      create: {
        slug: SLUG,
        name: 'Change a leaning',
        description:
          'Moves one of the person’s own voice leanings a stop, when they ask or agree to a suggestion. Writes only their own setting, as a new version.',
        category: 'app',
        rateLimit: 10,
        isActive: true,
        isSystem: true,
        ...SET_LEANING_IMPL,
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
    logger.info(`🧬 Granted ${SLUG} — the guide may change a leaning a person asks for`);
  },
};

export default unit;
