/**
 * Pin the model she runs on — and the bare control's, to the same one.
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
 * **The agents' provider and model are operator-owned.** This is the dev pin;
 * production's model is chosen later by evaluation, and that has to be an admin
 * edit rather than a deploy. So the pin is written only where BOTH columns are
 * still blank — the state units 003/004 create — and a value somebody set is
 * never written over, including a half-set one (a provider with no model is an
 * edit too, and guessing the other half would be this seed deciding for them).
 * The consequence, stated rather than discovered: editing `PINNED_MODEL` changes
 * what a fresh install gets and nothing on an install that already has a pin.
 *
 * `fallbackProviders` is never written. The column defaults to empty and "no
 * fallback" is that default left alone; a non-empty list is an operator's, and is
 * reported rather than cleared.
 *
 * **The default task models are operator-owned, per key.** `routing` and `chat`
 * are filled when blank and left alone when not, independently — an admin who
 * chose a routing model and never touched chat keeps the first and gets the
 * second. The other task keys are not this unit's.
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
 * agent whose model changed with no entry saying so — while "restore to v1" put
 * her back on the floating default with one click. So the write goes through the
 * platform's own snapshot helpers, inside one transaction with the update, and
 * mirrors the route's legacy case: an agent with no history gets its blank state
 * recorded as v1 first. On a fresh database that is every time, because the
 * platform's `020-agent-initial-versions` sorts BEFORE this directory and so
 * never sees her.
 *
 * ## Idempotent, safe on empty, no timestamp churn
 *
 * Every write is preceded by a comparison; a re-run against a current database
 * issues no write at all.
 *
 * A missing agent THROWS. `prisma/runner.ts` records a unit as applied the moment
 * `run()` resolves, so a quiet return would bank "pinned nothing" as a success
 * and every later `db:seed` would skip it — see `003-voice-fingerprint.ts`. Both
 * agents are checked before anything is written, so a half-seeded install is not
 * left with one arm pinned and the other floating.
 *
 * ## What this unit deliberately does not do
 *
 * It does not touch visibility, capabilities or anything on the turn path; those
 * land with the turn seam (§08 t-54). It does not price the dated id: a row in
 * this table cannot carry a split rate, so that is `lib/app/llm-providers.ts`
 * registering `PINNED_MODEL_INFO` — see `lib/app/agent/pinned-model.ts`.
 *
 * @see lib/app/agent/pins.ts
 * @see .context/app/agent.md
 */

import type { Prisma } from '@prisma/client';

import type { SeedUnit } from '@/prisma/runner';
import { serviceAccountWhere } from '@/lib/auth/account';
import {
  INITIAL_VERSION_SUMMARY,
  asSnapshotJson,
  buildAgentSnapshot,
  nextAgentVersionNumber,
} from '@/lib/orchestration/agents/agent-versioning';
import {
  PINNED_AGENT_SLUGS,
  PINNED_MODEL,
  PINNED_MODEL_MATRIX_ROW,
  PINNED_PROVIDER,
  PIN_CHANGE_SUMMARY,
  SIDE_ROLE_MODEL,
  SIDE_ROLE_TASKS,
} from '@/lib/app/agent/pins';

/** The matrix columns this unit reconciles, in one place so create, compare and update agree. */
const MATRIX_PROJECTION = {
  providerSlug: PINNED_MODEL_MATRIX_ROW.providerSlug,
  modelId: PINNED_MODEL_MATRIX_ROW.modelId,
  name: PINNED_MODEL_MATRIX_ROW.name,
  description: PINNED_MODEL_MATRIX_ROW.description,
  capabilities: [...PINNED_MODEL_MATRIX_ROW.capabilities],
  tierRole: PINNED_MODEL_MATRIX_ROW.tierRole,
  reasoningDepth: PINNED_MODEL_MATRIX_ROW.reasoningDepth,
  latency: PINNED_MODEL_MATRIX_ROW.latency,
  costEfficiency: PINNED_MODEL_MATRIX_ROW.costEfficiency,
  contextLength: PINNED_MODEL_MATRIX_ROW.contextLength,
  toolUse: PINNED_MODEL_MATRIX_ROW.toolUse,
  bestRole: PINNED_MODEL_MATRIX_ROW.bestRole,
  costPerMillionTokens: PINNED_MODEL_MATRIX_ROW.costPerMillionTokens,
};

type MatrixColumn = keyof typeof MATRIX_PROJECTION;

const MATRIX_SELECT = {
  id: true,
  slug: true,
  isDefault: true,
  providerSlug: true,
  modelId: true,
  name: true,
  description: true,
  capabilities: true,
  tierRole: true,
  reasoningDepth: true,
  latency: true,
  costEfficiency: true,
  contextLength: true,
  toolUse: true,
  bestRole: true,
  costPerMillionTokens: true,
} as const;

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

const unit: SeedUnit = {
  name: 'app-lelanea/005-agent-models',
  // The values live in `pinned-model.ts` and `pins.ts`; the slugs it pins are
  // derived from the two voice modules. Change either slug and this unit must re-run, or it keeps
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
      where: { slug: { in: [...PINNED_AGENT_SLUGS] } },
      include: {
        grantedTags: { select: { tagId: true } },
        grantedDocuments: { select: { documentId: true } },
      },
    });
    const missing = PINNED_AGENT_SLUGS.filter(
      (slug) => !agents.some((agent) => agent.slug === slug)
    );
    if (missing.length > 0) {
      // THROW, not return — see the header.
      logger.error('agent models: an agent to pin does not exist — refusing to record success', {
        missing,
      });
      throw new Error(
        `Cannot pin a model on ${missing.join(' and ')}: no such agent. Units 003-voice-fingerprint and 004-voice-golden-set create them and sort before this one — check that they ran.`
      );
    }

    // ---- The matrix row: seed-managed, the platform's protocol --------------
    const bySlug = await prisma.aiProviderModel.findUnique({
      where: { slug: PINNED_MODEL_MATRIX_ROW.slug },
      select: MATRIX_SELECT,
    });
    const matrixRow =
      bySlug ??
      (await prisma.aiProviderModel.findUnique({
        where: {
          providerSlug_modelId: {
            providerSlug: PINNED_MODEL_MATRIX_ROW.providerSlug,
            modelId: PINNED_MODEL_MATRIX_ROW.modelId,
          },
        },
        select: MATRIX_SELECT,
      }));

    if (!matrixRow) {
      await prisma.aiProviderModel.create({
        data: {
          slug: PINNED_MODEL_MATRIX_ROW.slug,
          ...MATRIX_PROJECTION,
          isDefault: true,
          createdBy: admin.id,
        },
      });
      logger.info(`📊 Added ${PINNED_MODEL} to the provider-model matrix`);
    } else if (matrixRow.slug !== PINNED_MODEL_MATRIX_ROW.slug || !matrixRow.isDefault) {
      // Somebody's own row for this model, or ours after an admin edited it.
      logger.info(`⏭  matrix row for ${PINNED_MODEL} is operator-owned — left alone`, {
        slug: matrixRow.slug,
      });
    } else {
      const stale = (Object.keys(MATRIX_PROJECTION) as MatrixColumn[]).filter((column) =>
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

    // ---- The pins: operator-owned, filled only when blank -------------------
    for (const slug of PINNED_AGENT_SLUGS) {
      const found = agents.find((agent) => agent.slug === slug);
      if (!found) continue; // unreachable — `missing` threw above
      const { grantedTags, grantedDocuments, ...row } = found;

      if (row.fallbackProviders.length > 0) {
        logger.warn(
          `${slug} has fallback providers set. The ruling for §08 is no fallback — a second provider would be asked for the same model string. Left as the operator set it.`,
          { fallbackProviders: row.fallbackProviders }
        );
      }

      if (row.provider !== '' || row.model !== '') {
        logger.info(`⏭  ${slug} already has a model somebody chose — left alone`, {
          provider: row.provider,
          model: row.model,
        });
        continue;
      }

      const grants = {
        grantedTagIds: grantedTags.map((grant) => grant.tagId),
        grantedDocumentIds: grantedDocuments.map((grant) => grant.documentId),
      };

      await prisma.$transaction(async (tx) => {
        let version = await nextAgentVersionNumber(tx, row.id);
        if (version === 1) {
          // No history at all: record the blank state first, as the admin route
          // does for a legacy agent, so the pin is a change FROM something.
          await tx.aiAgentVersion.create({
            data: {
              agentId: row.id,
              version,
              snapshot: asSnapshotJson(buildAgentSnapshot(row, grants)),
              changeSummary: INITIAL_VERSION_SUMMARY,
              createdBy: row.createdBy ?? admin.id,
            },
          });
          version += 1;
        }

        const updated = await tx.aiAgent.update({
          where: { id: row.id },
          data: { provider: PINNED_PROVIDER, model: PINNED_MODEL },
        });
        await tx.aiAgentVersion.create({
          data: {
            agentId: row.id,
            version,
            snapshot: asSnapshotJson(buildAgentSnapshot(updated, grants)),
            changeSummary: PIN_CHANGE_SUMMARY,
            createdBy: admin.id,
          },
        });
      });
      logger.info(`📌 Pinned ${slug} to ${PINNED_PROVIDER} / ${PINNED_MODEL}`);
    }

    // ---- The side roles' default task models: filled per key, when blank ----
    const settings = await prisma.aiOrchestrationSettings.findUnique({
      where: { slug: 'global' },
      select: { id: true, defaultModels: true },
    });
    // The RAW object, not `parseStoredDefaults()`: that helper collapses a map
    // with one bad value to `{}`, and spreading `{}` back would drop every other
    // key an operator had saved in order to fill two.
    const raw = settings?.defaultModels;
    const stored: Prisma.JsonObject =
      raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const blank = SIDE_ROLE_TASKS.filter((task) => {
      const value = stored[task];
      return typeof value !== 'string' || value.length === 0;
    });

    if (blank.length === 0) {
      logger.info('⏭  default task models already chosen — left alone');
      return;
    }

    const filled: Prisma.InputJsonObject = {
      ...stored,
      ...Object.fromEntries(blank.map((task) => [task, SIDE_ROLE_MODEL])),
    };
    if (settings) {
      await prisma.aiOrchestrationSettings.update({
        where: { id: settings.id },
        data: { defaultModels: filled },
      });
    } else {
      // Every other column has a database default; this is the same minimal
      // create the platform's knowledge seeder uses when it gets here first.
      await prisma.aiOrchestrationSettings.create({
        data: { slug: 'global', defaultModels: filled },
      });
    }
    logger.info(`🧭 Default task models filled: ${blank.join(', ')} → ${SIDE_ROLE_MODEL}`);
  },
};

export default unit;
