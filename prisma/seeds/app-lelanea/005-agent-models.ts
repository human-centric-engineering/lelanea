/**
 * Pin the model she runs on — and keep the bare control on the same one.
 *
 * Before this runs her agent has no model of her own. Units 003 and 004 create
 * both agents with an empty provider and model, which the platform resolves at
 * turn time from this install's default chat model: so a change to a platform
 * default would change her voice overnight, and nobody would have decided it.
 * The control floats the same way, which is the only reason the two arms of the
 * golden set have compared like with like so far.
 *
 * This unit makes the choice a decision on the record. What is pinned, and why
 * that model and no fallback, is in `lib/app/agent/pins.ts`.
 *
 * ## Three kinds of row, three ownership rules (`fp4`)
 *
 * **Her provider and model are operator-owned.** This is the dev pin;
 * production's model is chosen later by evaluation, and that has to be an admin
 * edit rather than a deploy. So the pin is written only where BOTH columns are
 * still blank — the state unit 003 creates — and a value somebody set is never
 * written over, including a half-set one (a provider with no model is an edit
 * too, and guessing the other half would be this seed deciding for them). The
 * consequence, stated rather than discovered: editing `PINNED_MODEL` changes what
 * a fresh install gets and nothing on an install that already has a pin.
 *
 * **The control's provider and model FOLLOW HERS.** It is an instrument, not a
 * second decision: it exists to be asked the same questions on the same model.
 * So a blank control is set to whatever she is on once her row is settled — the
 * dev pin, or the model an admin chose for her — and never to the dev pin on its
 * own account. The first version of this unit pinned each arm independently,
 * and an install where an admin had already chosen her model got a control on a
 * DIFFERENT one, with a timeline entry saying "pinned": a guaranteed mismatch,
 * manufactured by the unit whose job is to prevent one. Caught by /code-review.
 * A control somebody has set is theirs and is left alone; if it differs from
 * hers, that is reported, and `assertArmsComparable` refuses the next run.
 *
 * `fallbackProviders` is never written. The column defaults to empty and "no
 * fallback" is that default left alone; a non-empty list is an operator's, and is
 * reported rather than cleared.
 *
 * **The matrix row is seed-managed, under the platform's own protocol**
 * (`009-provider-models.ts`): `isDefault: true` means the seed owns it and
 * reconciles it; an admin edit flips `isDefault` off and the row is left alone
 * from then on. One addition — the table is also unique on
 * `(providerSlug, modelId)`, so a row an admin already added for the dated id
 * under their own slug is theirs, and creating ours beside it would fail on that
 * constraint. It is left alone too.
 *
 * ## The pin is an entry in the agent's version timeline
 *
 * The admin PATCH route snapshots a version whenever a versioned field changes; a
 * seed writing the column directly would not, and the timeline would show an
 * agent whose model changed with no entry saying so. So the write goes through
 * the platform's own snapshot helpers, inside one transaction with the update,
 * and mirrors the route's legacy case: an agent with no history gets its blank
 * state recorded as v1 first. On a fresh database that is every time, because the
 * platform's `020-agent-initial-versions` sorts BEFORE this directory and so
 * never sees her.
 *
 * What that does NOT do is take away the way back: restoring v1 returns her to
 * the floating default, as restoring any agent's first version returns it to how
 * it was created. That is an admin's deliberate act on operator-owned config,
 * and it now leaves an entry of its own.
 *
 * ## Whether there is anywhere for her turns to go
 *
 * An explicit provider is never re-picked and there is no fallback, so a pin to
 * a slug this install cannot reach ends every one of her turns. Two states look
 * alike from here and are not:
 *
 * - **No active provider at all** — a fresh install. `db:seed` always runs before
 *   setup, and the runner records a unit as applied once and does not come back,
 *   so waiting would mean never pinning. The pin is written, and the unit says
 *   loudly that nothing can serve it yet.
 * - **Active providers, none under the pinned slug** — an install that is already
 *   running, on Anthropic, or on OpenAI under a slug of its own. She is WORKING
 *   there, on the install default, and writing the pin would break her with a log
 *   line as the only notice. So the unit writes nothing to her and THROWS, naming
 *   the two ways out: not recorded as applied, tried again on the next seed, and
 *   she keeps answering in the meantime. The first version only warned. Caught by
 *   /code-review.
 *
 * Neither applies when somebody has already chosen her model — that provider is
 * theirs to have checked.
 *
 * ## Idempotent, safe on empty, no timestamp churn
 *
 * Every write is preceded by a comparison; a re-run against a current database
 * issues no write at all.
 *
 * A missing agent THROWS. `prisma/runner.ts` records a unit as applied the moment
 * `run()` resolves, so a quiet return would bank "pinned nothing" as a success
 * and every later `db:seed` would skip it — see `003-voice-fingerprint.ts`. Both
 * agents are checked before anything is written, and a soft-deleted agent counts
 * as missing — the slug is unique, so units 003/004 will not recreate it, and
 * unit 006 refuses it too.
 *
 * **The blank check is part of the write.** Her row is read at the top and
 * written later; an admin who chose her model in between would have had it
 * replaced by the dev pin. So the update carries the predicate itself —
 * `provider: ''` and `model: ''` — and a write that matches no row writes no
 * version either. Caught by /code-review.
 *
 * ## What this unit deliberately does not do
 *
 * **It does not set the platform's default task models.** The first version
 * filled blank `chat` and `routing` defaults with `gpt-4o-mini`. But this unit
 * runs before any provider exists, and the setup wizard fills those same slots
 * from the provider the operator actually configures — unless they are already
 * taken. So the fill pre-empted the better-informed writer, and an install that
 * configured anything but OpenAI got every unbound platform agent asking its
 * provider for a model it does not serve. The side roles are left to the wizard
 * and the settings page. Caught by /code-review.
 *
 * It does not touch visibility, capabilities or anything on the turn path; those
 * land with the turn seam (§08 t-54). It does not price the dated id: a row in
 * the matrix cannot carry a split rate, so that is `ensurePinnedModelPriced()` —
 * see `lib/app/agent/pinned-model.ts`.
 *
 * @see lib/app/agent/pins.ts
 * @see .context/app/agent.md
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import type { SeedUnit } from '@/prisma/runner';
import { serviceAccountWhere } from '@/lib/auth/account';
import {
  INITIAL_VERSION_SUMMARY,
  asSnapshotJson,
  buildAgentSnapshot,
  nextAgentVersionNumber,
} from '@/lib/orchestration/agents/agent-versioning';
import {
  CONTROL_FOLLOWS_SUMMARY,
  PINNED_MODEL,
  PINNED_MODEL_MATRIX_ROW,
  PINNED_PROVIDER,
  PIN_CHANGE_SUMMARY,
} from '@/lib/app/agent/pins';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';
import { VOICE_CONTROL_AGENT_SLUG } from '@/lib/app/voice/golden-set';

/**
 * The matrix columns this unit reconciles — everything on the row but its key.
 *
 * ONE list, derived. An earlier version spelt the columns out three times (the
 * row, a projection, a select), where a column added to one and not the others is
 * either never reconciled or compared against `undefined` and rewritten on every
 * re-seed. The reads below take the whole row for the same reason: a `select`
 * would be a second list.
 */
const { slug: MATRIX_SLUG, ...MATRIX_ROW } = PINNED_MODEL_MATRIX_ROW;
const MATRIX_PROJECTION = { ...MATRIX_ROW, capabilities: [...MATRIX_ROW.capabilities] };
const MATRIX_COLUMNS = Object.keys(MATRIX_PROJECTION) as (keyof typeof MATRIX_PROJECTION)[];

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

const AGENT_INCLUDE = {
  grantedTags: { select: { tagId: true } },
  grantedDocuments: { select: { documentId: true } },
} as const;

type AgentWithGrants = Prisma.AiAgentGetPayload<{ include: typeof AGENT_INCLUDE }>;

/**
 * Write a provider + model onto an agent that still has neither, as an entry in
 * its version timeline. Resolves `false` when somebody got there first.
 *
 * One transaction: the update and its snapshot land together or not at all. An
 * agent with no history gets its prior state recorded as v1 first, as the admin
 * route does for a legacy agent, so the change is a change FROM something.
 */
async function writeBinding(
  prisma: PrismaClient,
  agent: AgentWithGrants,
  binding: { provider: string; model: string },
  changeSummary: string,
  actorId: string
): Promise<boolean> {
  const { grantedTags, grantedDocuments, ...row } = agent;
  const grants = {
    grantedTagIds: grantedTags.map((grant) => grant.tagId),
    grantedDocumentIds: grantedDocuments.map((grant) => grant.documentId),
  };

  return prisma.$transaction(async (tx) => {
    // The predicate, not the row read at the top of `run()`: see the header.
    const { count } = await tx.aiAgent.updateMany({
      where: { id: row.id, provider: '', model: '' },
      data: binding,
    });
    if (count === 0) return false;

    let version = await nextAgentVersionNumber(tx, row.id);
    if (version === 1) {
      await tx.aiAgentVersion.create({
        data: {
          agentId: row.id,
          version,
          snapshot: asSnapshotJson(buildAgentSnapshot(row, grants)),
          changeSummary: INITIAL_VERSION_SUMMARY,
          createdBy: row.createdBy ?? actorId,
        },
      });
      version += 1;
    }

    await tx.aiAgentVersion.create({
      data: {
        agentId: row.id,
        version,
        // `row` is how she was; with the binding laid over it, how she is. The
        // predicate above is what makes that true of the two columns that matter.
        snapshot: asSnapshotJson(buildAgentSnapshot({ ...row, ...binding }, grants)),
        changeSummary,
        createdBy: actorId,
      },
    });
    return true;
  });
}

const unit: SeedUnit = {
  name: 'app-lelanea/005-agent-models',
  // The values live in `pinned-model.ts` and `pins.ts`; the two slugs come from
  // the voice modules. Change either slug and this unit must re-run, or it keeps
  // looking for an agent under a name nothing creates any more.
  hashInputs: [
    '../../../lib/app/agent/pinned-model.ts',
    '../../../lib/app/agent/pins.ts',
    '../../../lib/app/voice/fingerprint.ts',
    '../../../lib/app/voice/golden-set.ts',
  ],
  async run({ prisma, logger }) {
    const admin = await prisma.user.findFirst({
      where: serviceAccountWhere,
      select: { id: true },
    });
    if (!admin) {
      throw new Error('No admin user found — ensure 001-system-owner runs first.');
    }

    // ---- Both agents, before anything is written ----------------------------
    const agents = await prisma.aiAgent.findMany({
      where: { slug: { in: [VOICE_AGENT_SLUG, VOICE_CONTROL_AGENT_SLUG] }, deletedAt: null },
      include: AGENT_INCLUDE,
    });
    const hers = agents.find((agent) => agent.slug === VOICE_AGENT_SLUG);
    const control = agents.find((agent) => agent.slug === VOICE_CONTROL_AGENT_SLUG);
    if (!hers || !control) {
      const missing = [
        ...(hers ? [] : [VOICE_AGENT_SLUG]),
        ...(control ? [] : [VOICE_CONTROL_AGENT_SLUG]),
      ];
      // THROW, not return — see the header.
      logger.error('agent models: an agent to pin does not exist — refusing to record success', {
        missing,
      });
      throw new Error(
        `Cannot pin a model on ${missing.join(' and ')}: no such agent. Units 003-voice-fingerprint and 004-voice-golden-set create them and sort before this one — check that they ran.`
      );
    }

    // ---- Is there anywhere for her turns to go? Asked before ANY write --------
    // See the header for why "none at all" and "some, but not this one" get
    // opposite answers. Only when this unit is about to choose for her.
    const herIsBlank = hers.provider === '' && hers.model === '';
    if (herIsBlank) {
      const activeProviders = await prisma.aiProviderConfig.findMany({
        where: { isActive: true },
        select: { slug: true },
      });
      const reachable = activeProviders.some((provider) => provider.slug === PINNED_PROVIDER);
      if (activeProviders.length > 0 && !reachable) {
        logger.error('agent models: the pinned provider is not one this install has', {
          pinned: PINNED_PROVIDER,
          active: activeProviders.map((provider) => provider.slug),
        });
        throw new Error(
          `She is to be pinned to the provider "${PINNED_PROVIDER}", and this install's active providers are ${activeProviders.map((provider) => `"${provider.slug}"`).join(', ')}. Writing the pin would end every one of her turns — there is no fallback, by design — so nothing was written and she is still answering on the install default. Either configure OpenAI under the slug "${PINNED_PROVIDER}", or choose her model in /admin/orchestration/agents (the control will follow it). Then run the seed again.`
        );
      }
      if (!reachable) {
        logger.warn(
          `She is being pinned to the provider "${PINNED_PROVIDER}", and this install has no active provider yet — normal on a fresh database, where seeding runs before setup. Until OpenAI is configured under that slug her turns and every golden-set run end with "provider unavailable": there is no fallback, by design.`
        );
      }
    }

    // ---- The matrix row: seed-managed, the platform's protocol --------------
    const matrixRow =
      (await prisma.aiProviderModel.findUnique({
        where: { slug: MATRIX_SLUG },
      })) ??
      (await prisma.aiProviderModel.findUnique({
        where: {
          providerSlug_modelId: {
            providerSlug: MATRIX_PROJECTION.providerSlug,
            modelId: MATRIX_PROJECTION.modelId,
          },
        },
      }));

    if (!matrixRow) {
      await prisma.aiProviderModel.create({
        data: { slug: MATRIX_SLUG, ...MATRIX_PROJECTION, isDefault: true, createdBy: admin.id },
      });
      logger.info(`📊 Added ${PINNED_MODEL} to the provider-model matrix`);
    } else if (matrixRow.slug !== MATRIX_SLUG || !matrixRow.isDefault) {
      // Somebody's own row for this model, or ours after an admin edited it.
      logger.info(`⏭  matrix row for ${PINNED_MODEL} is operator-owned — left alone`, {
        slug: matrixRow.slug,
      });
    } else {
      const stale = MATRIX_COLUMNS.filter((column) =>
        column === 'capabilities'
          ? !sameList(matrixRow.capabilities, MATRIX_PROJECTION.capabilities)
          : matrixRow[column] !== MATRIX_PROJECTION[column]
      );
      if (stale.length === 0) {
        logger.info(`⏭  matrix row for ${PINNED_MODEL} already current`);
      } else {
        await prisma.aiProviderModel.update({
          where: { id: matrixRow.id },
          data: MATRIX_PROJECTION,
        });
        logger.info(`📊 Corrected the matrix row for ${PINNED_MODEL}`, { fields: stale });
      }
    }

    for (const agent of [hers, control]) {
      if (agent.fallbackProviders.length > 0) {
        logger.warn(
          `${agent.slug} has fallback providers set. The ruling for §08 is no fallback — a second provider would be asked for the same model string. Left as the operator set it.`,
          { fallbackProviders: agent.fallbackProviders }
        );
      }
    }

    // ---- Her pin: operator-owned, filled only when blank --------------------
    let herBinding = { provider: hers.provider, model: hers.model };
    if (herIsBlank) {
      const pinned = { provider: PINNED_PROVIDER, model: PINNED_MODEL };
      if (await writeBinding(prisma, hers, pinned, PIN_CHANGE_SUMMARY, admin.id)) {
        herBinding = pinned;
        logger.info(`📌 Pinned ${hers.slug} to ${PINNED_PROVIDER} / ${PINNED_MODEL}`);
      } else {
        // Somebody chose her model between the read and the write. Theirs stands;
        // re-read it so the control follows what is actually there.
        const current = await prisma.aiAgent.findUniqueOrThrow({
          where: { id: hers.id },
          select: { provider: true, model: true },
        });
        // The two columns, by name — never the row. What follows is written onto
        // the control, and a binding that carried anything else would go with it.
        herBinding = { provider: current.provider, model: current.model };
        logger.info(`⏭  ${hers.slug} was given a model while this ran — left alone`, herBinding);
      }
    } else {
      logger.info(`⏭  ${hers.slug} already has a model somebody chose — left alone`, herBinding);
    }

    // ---- The control: follows her, whatever she is on -----------------------
    const herBindingIsWhole = herBinding.provider !== '' && herBinding.model !== '';
    const controlIsBlank = control.provider === '' && control.model === '';
    const controlMatches =
      control.provider === herBinding.provider && control.model === herBinding.model;

    if (controlMatches) {
      logger.info(`⏭  ${control.slug} already on her model`);
    } else if (
      controlIsBlank &&
      herBindingIsWhole &&
      (await writeBinding(prisma, control, herBinding, CONTROL_FOLLOWS_SUMMARY, admin.id))
    ) {
      logger.info(
        `📌 Set ${control.slug} to her model, ${herBinding.provider} / ${herBinding.model}`
      );
    } else {
      // Hers is half-set, or the control is somebody's and differs. Either way
      // there is no value this unit may write, and the comparison will refuse to
      // run until a person matches them — so say so here, where it is cheap.
      logger.warn(
        `The two arms of the voice comparison are on different models, and this seed will not choose between them. Match them in /admin/orchestration/agents, or the next golden-set run is refused.`,
        {
          [hers.slug]: herBinding,
          [control.slug]: { provider: control.provider, model: control.model },
        }
      );
    }
  },
};

export default unit;
