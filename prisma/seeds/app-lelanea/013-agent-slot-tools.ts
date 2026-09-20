/**
 * Give her the profile — the two slot tools, and what she may see through them
 * (f-slots t-72).
 *
 * Until this runs she holds `search_knowledge_base` alone (`007-agent-reachable`),
 * so everything a person tells her lives in the transcript and nowhere else.
 * This grants `get_state` and `fill_slot`, each with the exposure allowlist that
 * decides which slots she may read back.
 *
 * ## Why a unit of its own and not more slugs in 007
 *
 * 007 grants a capability and nothing else — `prisma.aiAgentCapability.create({
 * data: { agentId, capabilityId } })`, no config. These two bindings carry
 * `customConfig`, which is the allowlist, and which has to be written **with**
 * the binding: a grant created first and configured second is permissive in
 * between, and on the path where the second write fails it stays that way with
 * nothing saying so.
 *
 * The two seeds also differ in what re-running them means. 007 declares
 * `hashInputs` on `pins.ts`, so editing that file re-runs it — which is right
 * for a list of slugs. This unit declares them too, and the allowlist is derived
 * from the taxonomy file, so a taxonomy edit that changes which groups are
 * readable re-runs this unit. What it does on that re-run is the next section.
 *
 * ## The rows this writes, and who owns them (`fp4`)
 *
 * **Operator-owned, filled once.** A binding that does not exist is created,
 * with its config. A binding that exists is **left exactly as it is** — switched
 * off, narrowed to fewer groups, widened, or configured by hand. All four are an
 * operator's decision, and a seed that "corrected" any of them would take back a
 * choice a person made in the admin. That is 007's rule and this unit does not
 * invent a different one.
 *
 * The consequence, stated rather than discovered: **a taxonomy change does not
 * reach an existing grant.** Add a group after this has run and she will not
 * read it back until an admin widens the allowlist. The alternative — reconciling
 * the config on every seed — would silently revert every narrowing an operator
 * had made, which is the worse of the two failures (`fp4`: with more than one
 * writer, do not reconcile what a human may have edited).
 *
 * **No removal pass**, and no timeline entry: grants are not in the agent
 * snapshot, so a restore to an earlier agent version does not take a tool away.
 * That is the platform's model of grants, not a choice made here — same note as
 * 007's.
 *
 * **Safe on empty.** A missing agent or a missing capability THROWS. The runner
 * records a unit as applied the moment `run()` resolves, so a quiet return would
 * bank "she can capture" for an agent that cannot, and the repair would never
 * run again.
 *
 * ## After this merges
 *
 * A changed tool grant is dark until each database is reseeded and each client
 * reconnects (`sunrise.mcp-reseed`). Nothing here can do either.
 *
 * @see lib/app/agent/pins.ts — `SLOT_CAPABILITY_SLUGS`, `SLOT_EXPOSURE_CONFIG`
 * @see lib/app/slots/capture.ts — the retry guard on the write
 * @see .context/app/slots.md — "Capture"
 */

import type { SeedUnit } from '@/prisma/runner';
import { SLOT_CAPABILITY_SLUGS, SLOT_EXPOSURE_CONFIG } from '@/lib/app/agent/pins';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';

const unit: SeedUnit = {
  name: 'app-lelanea/013-agent-slot-tools',
  hashInputs: [
    '../../../lib/app/agent/pins.ts',
    '../../../content/lelanea_slot_taxonomy.json',
    '../../../lib/app/content/slot-taxonomy.ts',
  ],
  async run({ prisma, logger }) {
    logger.info('🧠 Giving her the profile...');

    const agent = await prisma.aiAgent.findFirst({
      where: { slug: VOICE_AGENT_SLUG, deletedAt: null },
      select: { id: true },
    });
    if (!agent) {
      throw new Error(
        `Cannot grant the slot tools to ${VOICE_AGENT_SLUG}: no such agent. Unit 003-voice-fingerprint creates her and sorts before this one — check that it ran.`
      );
    }

    // Read before any write, so a missing capability leaves every binding as it
    // was rather than granting the half that exists.
    const capabilities = await prisma.aiCapability.findMany({
      where: { slug: { in: [...SLOT_CAPABILITY_SLUGS] } },
      select: { id: true, slug: true },
    });
    const missing = SLOT_CAPABILITY_SLUGS.filter(
      (slug) => !capabilities.some((capability) => capability.slug === slug)
    );
    if (missing.length > 0) {
      throw new Error(
        `Cannot grant ${missing.join(', ')} to ${VOICE_AGENT_SLUG}: no such capability. Daybreak's own seed units create the data-slot capabilities and sort before this one — check that they ran.`
      );
    }

    // The allowlist, once, so both bindings carry the same object rather than
    // two that can drift apart under an operator who edits one of them.
    //
    // `fill_slot` reads only the `write` facet and there isn't one, so this is
    // inert on that binding — deliberately. Writing the same config to both
    // means an admin who narrows her reads sees the same allowlist on both
    // rows, instead of one row that looks unconfigured.
    //
    // Rebuilt rather than passed through: the constant is `as const`, and
    // Prisma's JSON input wants a mutable value. No `as`.
    const customConfig = { read: { groups: [...SLOT_EXPOSURE_CONFIG.read.groups] } };

    for (const capability of capabilities) {
      const existing = await prisma.aiAgentCapability.findUnique({
        where: { agentId_capabilityId: { agentId: agent.id, capabilityId: capability.id } },
        select: { isEnabled: true, customConfig: true },
      });
      if (existing) {
        logger.info(
          existing.isEnabled
            ? `⏭  ${capability.slug} already granted — its allowlist is an operator's, left alone`
            : `⏭  ${capability.slug} is granted and switched off — an operator's switch, left alone`
        );
        continue;
      }
      await prisma.aiAgentCapability.create({
        data: { agentId: agent.id, capabilityId: capability.id, customConfig },
      });
      logger.info(`🧬 Granted ${capability.slug}`);
    }

    logger.info(
      `🔒 She may read back: ${SLOT_EXPOSURE_CONFIG.read.groups.join(', ')} — and writes anywhere, bounded by her instructions`
    );
  },
};

export default unit;
