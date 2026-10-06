/**
 * Seat the synopsis agent — create it, and bind it to the `synopsis` seat
 * (f-journey-record t-146).
 *
 * Before this runs the seat is empty, as Daybreak ships every seat, and no
 * session gets a synopsis: `synopsis/draft.ts` reads the seat and drafts
 * nothing when nobody holds it.
 *
 * ## The rows this writes, and who owns them (`fp4`)
 *
 * **The agent is split, as hers is (`003-voice-fingerprint.ts`).** Three
 * columns are code-owned and reconciled: `profileId` (so it speaks in her voice
 * profile), `knowledgeAccessMode` (`restricted`, the rule every agent of hers
 * carries), and `systemInstructions`, which `SYSTEM_AGENT_PROTECTED_FIELDS`
 * keeps any operator from editing, so a write-once value would be unreachable
 * by anyone. Everything else is written once. Its provider and model are left
 * empty, so it resolves from the install's default chat model until an
 * operator picks one, and a re-seed never overwrites their pick.
 *
 * **The seat is filled only when it is empty**, as seed 006 fills hers. A seat
 * held by another agent is a binding an operator made on purpose, and is
 * reported and left alone. The same known limit applies: an admin who unbinds
 * it and leaves the seat empty sees it refilled the next time this unit runs.
 *
 * **Idempotent, no timestamp churn.** Nothing already current is written.
 *
 * **Safe on empty.** A missing service account or voice profile THROWS, because
 * the runner records a unit as applied when `run()` resolves, and a quiet return
 * would bank "seated nobody" as a success that every later `db:seed` skips.
 *
 * ## Existing databases
 *
 * A new unit runs on the next `db:seed` of every database. Until then that
 * database drafts no synopses, which is what it did before this task: the
 * standing step after merge is to run it.
 *
 * @see lib/app/journey-record/synopsis/agent.ts
 * @see lib/app/agent/pins.ts — `SYNOPSIS_SEAT`
 */

import type { SeedUnit } from '@/prisma/runner';
import { serviceAccountWhere } from '@/lib/auth/account';
import { bindFacilitationAgent } from '@/lib/framework/facilitation/agents/binding-service';
import { getFacilitationBindingByRole } from '@/lib/framework/facilitation/agents/binding-queries';
import { SYNOPSIS_SEAT } from '@/lib/app/agent/pins';
import { VOICE_PROFILE_SLUG } from '@/lib/app/voice/fingerprint';
import {
  SYNOPSIS_AGENT_DESCRIPTION,
  SYNOPSIS_AGENT_NAME,
  SYNOPSIS_AGENT_SLUG,
  SYNOPSIS_AGENT_SYSTEM_INSTRUCTIONS,
} from '@/lib/app/journey-record/synopsis/agent';

/** The mode every agent of hers carries. See `003-voice-fingerprint.ts`. */
const REQUIRED_KNOWLEDGE_ACCESS_MODE = 'restricted';

const unit: SeedUnit = {
  name: 'app-lelanea/026-synopsis-seat',
  // Relative to this file, as the runner requires.
  hashInputs: [
    '../../../lib/app/journey-record/synopsis/agent.ts',
    '../../../lib/app/agent/pins.ts',
    '../../../lib/app/voice/fingerprint.ts',
  ],
  async run({ prisma, logger }) {
    logger.info('🪑 Seating the synopsis agent...');

    const admin = await prisma.user.findFirst({
      where: serviceAccountWhere,
      select: { id: true },
    });
    if (!admin) {
      throw new Error('No service account found — ensure 001-system-owner runs first.');
    }

    const profile = await prisma.aiAgentProfile.findUnique({
      where: { slug: VOICE_PROFILE_SLUG },
      select: { id: true },
    });
    if (!profile) {
      // THROW, not return — see the header.
      throw new Error(
        `Cannot seat ${SYNOPSIS_AGENT_SLUG}: no ${VOICE_PROFILE_SLUG} profile. Unit 003-voice-fingerprint creates it and sorts before this one — check that it ran.`
      );
    }

    // ---- The agent: created once, three columns reconciled ------------------
    const existing = await prisma.aiAgent.findFirst({
      where: { slug: SYNOPSIS_AGENT_SLUG },
      select: {
        id: true,
        profileId: true,
        knowledgeAccessMode: true,
        systemInstructions: true,
        deletedAt: true,
      },
    });

    let agentId: string;
    if (!existing) {
      const created = await prisma.aiAgent.create({
        data: {
          name: SYNOPSIS_AGENT_NAME,
          slug: SYNOPSIS_AGENT_SLUG,
          description: SYNOPSIS_AGENT_DESCRIPTION,
          systemInstructions: SYNOPSIS_AGENT_SYSTEM_INSTRUCTIONS,
          // Empty, so it resolves from the install's default chat model and an
          // operator's later pick is never overwritten.
          model: '',
          provider: '',
          isActive: true,
          isSystem: true,
          knowledgeAccessMode: REQUIRED_KNOWLEDGE_ACCESS_MODE,
          // Her voice comes from the profile; the agent's own inheritable
          // columns stay NULL so there is one copy of it.
          profileId: profile.id,
          createdBy: admin.id,
        },
        select: { id: true },
      });
      agentId = created.id;
      logger.info(`🤖 Created ${SYNOPSIS_AGENT_SLUG} (profile ${VOICE_PROFILE_SLUG})`);
    } else {
      agentId = existing.id;
      if (existing.deletedAt) {
        // A deleted agent is an operator's decision; seating it would undo it.
        logger.warn(`${SYNOPSIS_AGENT_SLUG} was deleted in the admin; the seat is left alone`);
        return;
      }
      const corrections: Record<string, string> = {};
      if (existing.profileId !== profile.id) corrections.profileId = profile.id;
      if (existing.knowledgeAccessMode !== REQUIRED_KNOWLEDGE_ACCESS_MODE) {
        corrections.knowledgeAccessMode = REQUIRED_KNOWLEDGE_ACCESS_MODE;
      }
      if (existing.systemInstructions !== SYNOPSIS_AGENT_SYSTEM_INSTRUCTIONS) {
        corrections.systemInstructions = SYNOPSIS_AGENT_SYSTEM_INSTRUCTIONS;
      }
      if (Object.keys(corrections).length > 0) {
        await prisma.aiAgent.update({ where: { id: agentId }, data: corrections });
        logger.info(`🤖 Corrected ${SYNOPSIS_AGENT_SLUG}`, { fields: Object.keys(corrections) });
      } else {
        logger.info(`⏭  ${SYNOPSIS_AGENT_SLUG} already current`);
      }
    }

    // ---- The seat: filled only when empty -----------------------------------
    const binding = await getFacilitationBindingByRole(SYNOPSIS_SEAT);
    if (!binding) {
      await bindFacilitationAgent({ agentId, role: SYNOPSIS_SEAT, userId: admin.id });
      logger.info(`✓ ${SYNOPSIS_AGENT_SLUG} bound to the "${SYNOPSIS_SEAT}" seat`);
      return;
    }
    if (binding.agentId === agentId) {
      logger.info(`⏭  "${SYNOPSIS_SEAT}" seat already held by ${SYNOPSIS_AGENT_SLUG}`);
      return;
    }
    logger.warn(
      `The "${SYNOPSIS_SEAT}" seat is held by another agent. This seed fills empty seats only and did not create that binding, so it is left alone — unbind it in the admin if ${SYNOPSIS_AGENT_SLUG} should have the seat.`,
      { role: SYNOPSIS_SEAT, heldBy: binding.agent?.slug ?? binding.agentId }
    );
  },
};

export default unit;
