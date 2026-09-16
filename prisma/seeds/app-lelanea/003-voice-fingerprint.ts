/**
 * Seed the always-on voice core — one profile, and the first agent that wears it.
 *
 * Before this runs there is no agent in this install that speaks as her, and no
 * row anywhere carrying how she sounds. This unit creates both: an
 * `AiAgentProfile` holding the three sections projected from the authored core,
 * and one `AiAgent` linked to it. From the moment it has run, every turn that
 * agent takes carries her identity, her grounding rule and her hard nos —
 * whether or not retrieval finds anything, because none of it comes from
 * retrieval.
 *
 * ## The row this writes, and who owns it (`fp4`)
 *
 * **The profile is a pure code projection.** Its three text columns are
 * reconciled on every run: they come from `content/lelanea_voice_fingerprint.json`
 * by way of `composeFingerprintProfileSections()`, and no operator is meant to
 * hand-edit her voice in the admin UI. That is the opposite call from the
 * designation tags next door, whose names and descriptions ARE operator-owned —
 * and the difference is that a tag name is a label, while this text is the
 * artefact itself.
 *
 * **The agent is split.** Three columns are code-owned and reconciled.
 * `profileId` and `knowledgeAccessMode` because both are load-bearing
 * invariants rather than preferences (see below); `systemInstructions` for the
 * opposite reason — `SYSTEM_AGENT_PROTECTED_FIELDS` covers it, so no operator
 * can set it and a write-once field would be unreachable by anyone after the
 * first create.
 *
 * Everything else is written once and never rewritten, so an operator who
 * renames it or retunes its temperature keeps that. Note that `isActive` is on
 * the protected list too: a system agent cannot be deactivated through the
 * admin at all, so "activation" is not among the things left to an operator.
 *
 * **Idempotent, and no timestamp churn.** Every write is preceded by a
 * comparison; a re-run on a database already holding the current version issues
 * no write at all, so `updatedAt` never moves.
 *
 * **Safe on empty.** The composed sections are checked before anything is
 * written, and a run that would blank a populated section aborts instead. Today
 * the strict Zod schema makes an empty source hard to produce — but the loader's
 * own docblock says the file moves behind a database the first time copy has to
 * change without a deploy, and on that day this guard is the only thing standing
 * between a bad read and a profile with no voice in it.
 *
 * **No deletion pass.** The rows this unit owns are the two it creates.
 *
 * ## `knowledgeAccessMode: 'restricted'`, explicitly, and reconciled
 *
 * This is the hard requirement of §05 t-26 and the reason the unit reconciles a
 * column at all. `resolveAgentDocumentAccess` short-circuits —
 * `if (agent.knowledgeAccessMode !== 'restricted') return { mode: 'full' }` —
 * **above** `collectAccessContributions()`, and `search_knowledge_base` only
 * applies a document filter in the `restricted` branch. The platform default is
 * `full`, in the Prisma column and in `agentCreateSchema` both.
 *
 * So an agent of hers left on the default never consults t-25's designation rule:
 * it searches the whole corpus, and material marked `purpose-voice` or
 * `sensitivity-client` is quoted back at someone exactly as if that task had
 * never shipped — while `/admin/app/knowledge` still reports **Agent may quote:
 * No** for it, because `isQuotable()` is a pure function of tags and knows
 * nothing about any agent's mode. The failure is silent and the surface vouches
 * against it.
 *
 * `SYSTEM_AGENT_PROTECTED_FIELDS` does not include `knowledgeAccessMode`, so an
 * admin PATCH can still flip it after this runs. Re-running this unit is the
 * remedy, and that is precisely why the column is reconciled rather than set
 * once at creation — but note that `npm run db:seed` on its own will NOT
 * re-run it. The runner skips any unit whose content hash is unchanged, and a
 * row that drifted underneath the seed is exactly the case where nothing in the
 * tree has changed. Delete this unit's `seed_history` row first. See
 * `.context/app/voice.md`.
 *
 * ## What this unit deliberately does not do
 *
 * **It binds no capabilities.** `search_knowledge_base` is t-27's, along with the
 * exemplar contributor. The mode is set now so that the rule is already live when
 * the tool arrives, rather than being something somebody has to remember.
 *
 * **It leaves `visibility` at the platform default (`internal`).** Widening it is
 * the job of whichever task builds the surface a member talks to, and shipping a
 * publicly reachable agent ahead of that surface would be a live endpoint nobody
 * had designed.
 *
 * @see lib/app/voice/fingerprint.ts — the projection, and the four-blocks-onto-three mapping
 * @see .context/app/voice.md
 */

import type { SeedUnit } from '@/prisma/runner';
import { serviceAccountWhere } from '@/lib/auth/account';
import { getVoiceFingerprint } from '@/lib/app/content';
import {
  VOICE_AGENT_SLUG,
  VOICE_AGENT_SYSTEM_INSTRUCTIONS,
  VOICE_PROFILE_SLUG,
  composeFingerprintProfileSections,
  type FingerprintProfileSections,
} from '@/lib/app/voice/fingerprint';

/**
 * The mode her agents must carry, as a constant rather than a literal at the
 * write site.
 *
 * Exported so the test asserts the same string the seed writes. A test carrying
 * its own copy of `'restricted'` would pass against a seed that had drifted to
 * anything else the column happens to accept.
 */
export const REQUIRED_KNOWLEDGE_ACCESS_MODE = 'restricted';

/** Is every section of the projection populated? */
export function sectionsArePopulated(sections: FingerprintProfileSections): boolean {
  return (
    sections.persona.trim().length > 0 &&
    sections.guardrails.trim().length > 0 &&
    sections.brandVoiceInstructions.trim().length > 0
  );
}

const unit: SeedUnit = {
  name: 'app-lelanea/003-voice-fingerprint',
  // The authored core and the projection that shapes it. Editing either — a new
  // line in her identity, a change to which block lands in which column — must
  // re-run this unit, or the database keeps serving the previous version of her
  // voice while the tree says otherwise.
  hashInputs: [
    '../../../content/lelanea_voice_fingerprint.json',
    '../../../lib/app/voice/fingerprint.ts',
  ],
  async run({ prisma, logger }) {
    const core = getVoiceFingerprint();
    const sections = composeFingerprintProfileSections(core);

    if (!sectionsArePopulated(sections)) {
      // THROW, not return. A partial projection would replace a populated
      // section with an empty one, and an agent with no guardrails is a worse
      // state than an agent a version behind — so the write is refused either
      // way. But `prisma/runner.ts` upserts the `SeedHistory` row with the
      // current content hash as soon as `run()` RESOLVES, and logs
      // `✓ applied`. A quiet return would therefore bank the aborted run as a
      // success and every later `db:seed` would skip the unit, leaving a fresh
      // install with no profile and no agent, permanently, until somebody
      // deleted the history row by hand. An abort designed to be loud would
      // have been the quietest possible failure. Caught by /code-review.
      logger.error('voice fingerprint: a composed section was empty — refusing to write', {
        version: core.collection.version,
      });
      throw new Error(
        `Voice fingerprint v${core.collection.version} composed an empty section — refusing to write a profile with no voice in it.`
      );
    }

    const admin = await prisma.user.findFirst({
      where: serviceAccountWhere,
      select: { id: true },
    });
    if (!admin) {
      throw new Error('No admin user found — ensure 001-system-owner runs first.');
    }

    // ---- The profile: pure code projection, fully reconciled ----------------
    // Every column this unit owns, projected in one place so the create, the
    // comparison and the update cannot disagree about what "current" means.
    // `description` carries the version, so it MUST be reconciled: leaving it
    // out (the first version of this) left the admin showing "v1.0" beside a
    // v1.1 persona, under a sentence claiming the row is overwritten by the
    // seed. Caught by /code-review.
    const profileProjection = {
      name: core.collection.title,
      description: `The always-on core of the voice fingerprint, v${core.collection.version}. Authored in content/lelanea_voice_fingerprint.json and reconciled by this seed — edits made here are overwritten.`,
      ...sections,
    };

    const existingProfile = await prisma.aiAgentProfile.findUnique({
      where: { slug: VOICE_PROFILE_SLUG },
      select: {
        id: true,
        name: true,
        description: true,
        persona: true,
        guardrails: true,
        brandVoiceInstructions: true,
      },
    });

    let profileId: string;
    if (!existingProfile) {
      const created = await prisma.aiAgentProfile.create({
        data: {
          slug: VOICE_PROFILE_SLUG,
          isSystem: true,
          createdBy: admin.id,
          ...profileProjection,
        },
        select: { id: true },
      });
      profileId = created.id;
      logger.info(`🗣️  Created voice profile ${VOICE_PROFILE_SLUG} v${core.collection.version}`);
    } else {
      profileId = existingProfile.id;
      const unchanged = (
        Object.keys(profileProjection) as (keyof typeof profileProjection)[]
      ).every((column) => existingProfile[column] === profileProjection[column]);

      if (unchanged) {
        logger.info(`⏭  voice profile already at v${core.collection.version}`);
      } else {
        await prisma.aiAgentProfile.update({
          where: { id: profileId },
          data: profileProjection,
        });
        logger.info(`🗣️  Updated voice profile to v${core.collection.version}`);
      }
    }

    // ---- The agent: created once, two columns reconciled forever after ------
    const existingAgent = await prisma.aiAgent.findUnique({
      where: { slug: VOICE_AGENT_SLUG },
      select: { id: true, profileId: true, knowledgeAccessMode: true, systemInstructions: true },
    });

    if (!existingAgent) {
      await prisma.aiAgent.create({
        data: {
          name: 'Lelañea',
          slug: VOICE_AGENT_SLUG,
          description:
            'The guide a person meets inside the app — her voice, her material, her boundaries.',
          systemInstructions: VOICE_AGENT_SYSTEM_INSTRUCTIONS,
          // Empty strings: resolved at runtime from the operator's first
          // configured provider and the system default chat model, the same
          // contract the platform's own seeded agents use.
          model: '',
          provider: '',
          isActive: true,
          isSystem: true,
          // Explicit, never by omission. The column's default is `full`, and a
          // `full` agent returns before any access contributor runs — see the
          // header.
          knowledgeAccessMode: REQUIRED_KNOWLEDGE_ACCESS_MODE,
          // The three inheritable columns are left NULL so the profile is what
          // speaks. Writing the core here as well would produce two copies of
          // her voice with nothing keeping them in step, and the agent's copy
          // would silently win.
          profileId,
          createdBy: admin.id,
        },
      });
      logger.info(`🤖 Created ${VOICE_AGENT_SLUG} (restricted, profile ${VOICE_PROFILE_SLUG})`);
      return;
    }

    const corrections: Record<string, string> = {};
    if (existingAgent.profileId !== profileId) corrections.profileId = profileId;
    if (existingAgent.knowledgeAccessMode !== REQUIRED_KNOWLEDGE_ACCESS_MODE) {
      corrections.knowledgeAccessMode = REQUIRED_KNOWLEDGE_ACCESS_MODE;
    }
    // Reconciled for the opposite reason to the other two. `systemInstructions`
    // is in `SYSTEM_AGENT_PROTECTED_FIELDS`, so the PATCH route rejects any
    // change to it on a system agent and the version-restore route skips it —
    // which means there is no operator edit here to preserve, and a
    // write-once field would be unreachable by ANYONE after the first create.
    // Editing `VOICE_AGENT_SYSTEM_INSTRUCTIONS` re-runs this unit via
    // `hashInputs`, and before this line the re-run found the other two columns
    // correct, logged "already restricted and linked", and left the old
    // instructions in place with no error and no remedy. Caught by /code-review.
    if (existingAgent.systemInstructions !== VOICE_AGENT_SYSTEM_INSTRUCTIONS) {
      corrections.systemInstructions = VOICE_AGENT_SYSTEM_INSTRUCTIONS;
    }

    if (Object.keys(corrections).length === 0) {
      logger.info(`⏭  ${VOICE_AGENT_SLUG} already restricted and linked`);
      return;
    }

    await prisma.aiAgent.update({ where: { id: existingAgent.id }, data: corrections });
    logger.info(`🤖 Corrected ${VOICE_AGENT_SLUG}`, { fields: Object.keys(corrections) });
  },
};

export default unit;
