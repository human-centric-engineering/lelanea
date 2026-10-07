/**
 * The memory search: its row, and the grant to the guide (f-memory t-130).
 *
 * `search_person_memory` is the app's own capability, so it needs what
 * `014-suggest-resource` and `023-set-register` give theirs: an
 * `ai_capability` row that advertises it, and a binding to `lelanea-guide`.
 * One unit for both, for 014's reason: a row with no grant is a tool nobody
 * holds.
 *
 * Existing databases get the row and the grant from the migration
 * `20261009100000_app_search_person_memory_capability`, which runs first; from
 * then on this unit's `upsert` takes its `update` branch, re-applying the
 * code-owned fields (#545). Its `create` branch is what writes the row on a
 * database whose admin deleted it. The operator-owned literals are pinned equal
 * to the migration's by `search-person-memory-capability.test.ts`.
 *
 * Code-owned fields re-applied; operator-owned fields and the grant written
 * once (`fp4`), exactly as 014. No `customConfig`: the search is per person by
 * construction, so there is nothing for an operator to allow or deny. A missing
 * agent throws, for 014's reason.
 *
 * ## After this merges
 * A new tool is dark until each database is reseeded or migrated, and each
 * client reconnects (`sunrise.mcp-reseed`).
 *
 * @see lib/app/memory/search-capability.ts — the handler, and the definition's twin
 * @see lib/app/agent/pins.ts — `MEMORY_CAPABILITY_SLUGS`
 */

import type { SeedUnit } from '@/prisma/runner';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';

const SLUG = 'search_person_memory';

/**
 * The code-owned half of the row. The class in
 * `lib/app/memory/search-capability.ts` carries the identical
 * `functionDefinition`; the test pins them equal.
 */
export const SEARCH_PERSON_MEMORY_IMPL = {
  executionType: 'internal',
  executionHandler: 'SearchPersonMemoryCapability',
  functionDefinition: {
    name: 'search_person_memory',
    description:
      'Search what this person has said to you before, the notes kept about them, and what they kept in their journey, by meaning. Call it when they mention someone or something they may have spoken about before, or when remembering it would help you meet them now. Each result says what it is (their own words, a note, something they wrote in their journey, or an account of a session they kept), when, and how to use it. Quote their words, and what they wrote, back only as theirs, never as yours or as Lelañea’s material. A note is your understanding of them, and an account they kept is what they hold true of a session: neither is something they said word for word. If nothing comes back, do not claim to remember.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to look for, in plain words: "my father", "starting the new job".',
          minLength: 1,
          maxLength: 500,
        },
      },
      required: ['query'],
    },
  },
};

const unit: SeedUnit = {
  name: 'app-lelanea/024-search-person-memory',
  hashInputs: ['../../../lib/app/memory/search-capability.ts', '../../../lib/app/agent/pins.ts'],
  async run({ prisma, logger }) {
    logger.info('🧠 Giving the guide a way to look back through what a person said...');

    const capability = await prisma.aiCapability.upsert({
      where: { slug: SLUG },
      update: { isSystem: true, ...SEARCH_PERSON_MEMORY_IMPL },
      create: {
        slug: SLUG,
        name: 'Search what the person said before',
        description:
          'Finds, by meaning, what this person has said before and the notes kept about them, so the guide can remember it with them. Reads only their own; writes nothing.',
        category: 'app',
        rateLimit: 20,
        isActive: true,
        isSystem: true,
        ...SEARCH_PERSON_MEMORY_IMPL,
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
    logger.info(`🧬 Granted ${SLUG} — the guide may look back through what a person said`);
  },
};

export default unit;
