/**
 * The resources tool: its row, and the grant to the guide (f-resources t-77).
 *
 * `suggest_resource` is the app's own capability — not one of Daybreak's, whose
 * rows the framework boot syncs, and not an override of a Sunrise built-in,
 * whose rows Sunrise's own seeds write. So it needs what a built-in gets from
 * `prisma/seeds/012-run-workflow.ts` and what the slot tools get from `013`:
 * an `ai_capability` row that advertises it, and a binding to `lelanea-guide`
 * that lets that agent call it. One unit for both, because neither is any use
 * without the other and a row with no grant is a tool nobody holds.
 *
 * ## The row: code-owned fields re-applied, operator-owned fields left alone
 *
 * `functionDefinition`, `executionType` and `executionHandler` describe what
 * the code does — the schema the model is shown, the handler the dispatcher
 * resolves — so they are re-applied on every run (#545: a seed that writes
 * them only on create leaves an existing row advertising the original schema
 * forever). `name`, `description`, `category`, `isActive` and `rateLimit` are
 * an admin's, written once. Sunrise's `capability-code-owned-fields` test reads
 * this file's `update:` branch and holds it to that.
 *
 * **The definition is a literal here, and the class carries the same one.**
 * Sunrise's seed reader resolves a spread only to a `const` in the same file,
 * so the definition cannot be imported from `lib/app/resources/suggest.ts`;
 * `tests/unit/prisma/seeds/app-lelanea/suggest-resource.test.ts` pins the two
 * equal, which is the parity Sunrise's own test gives its built-ins.
 *
 * ## The grant: operator-owned, filled once (`fp4`)
 *
 * As `013`: a binding that does not exist is created, switched on; one that
 * exists — switched off, or edited — is an operator's and is left exactly as it
 * is. No `customConfig`: an id in, a library record out, nothing to allow or
 * deny. No removal pass, and no timeline entry, for `007`'s reasons.
 *
 * **Safe on empty.** A missing agent THROWS: the runner records a unit as
 * applied the moment `run()` resolves, and a quiet return would bank "the
 * guide can suggest" for an agent that cannot.
 *
 * ## After this merges
 *
 * A new tool is dark until each database is reseeded and each client
 * reconnects (`sunrise.mcp-reseed`). Nothing here can do either.
 *
 * @see lib/app/resources/suggest.ts — the handler, and the definition's twin
 * @see lib/app/agent/pins.ts — `RESOURCE_CAPABILITY_SLUGS`
 * @see .context/app/agent.md — "What she may reach for"
 */

import type { SeedUnit } from '@/prisma/runner';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';

const SLUG = 'suggest_resource';

/**
 * The code-owned half of the row. The class in `lib/app/resources/suggest.ts`
 * carries the identical `functionDefinition`; the test pins them equal.
 */
export const SUGGEST_RESOURCE_IMPL = {
  executionType: 'internal',
  executionHandler: 'SuggestResourceCapability',
  functionDefinition: {
    name: 'suggest_resource',
    description:
      'Offer the person one of Lelañea’s films or pieces of writing, by its id, when it genuinely fits what they are working through right now. Use an id from the list of resources in your context — never invent one. Suggest one thing at a time, and only when it would help; most turns need none. The person sees the resource beside your reply and can open it.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The id of the film or reading, exactly as listed in your context.',
          maxLength: 80,
        },
      },
      required: ['id'],
    },
  },
};

const unit: SeedUnit = {
  name: 'app-lelanea/014-suggest-resource',
  hashInputs: ['../../../lib/app/resources/suggest.ts', '../../../lib/app/agent/pins.ts'],
  async run({ prisma, logger }) {
    logger.info('🎞  Giving the guide the resources...');

    const capability = await prisma.aiCapability.upsert({
      where: { slug: SLUG },
      update: { isSystem: true, ...SUGGEST_RESOURCE_IMPL },
      create: {
        slug: SLUG,
        name: 'Suggest a resource',
        description:
          'Hands the person one of Lelañea Fulton’s films or pieces of writing, by id, when it fits what they are working through. Read-only: the library answers with its own words.',
        category: 'app',
        rateLimit: 30,
        isActive: true,
        isSystem: true,
        ...SUGGEST_RESOURCE_IMPL,
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
    logger.info(`🧬 Granted ${SLUG} — the guide may hand a person a film or a piece of writing`);
  },
};

export default unit;
