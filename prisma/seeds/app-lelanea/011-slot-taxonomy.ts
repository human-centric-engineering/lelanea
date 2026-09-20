/**
 * The slot taxonomy, moved into the tables an admin edits — once (f-slots t-70).
 *
 * Fills `app_slot_definition` and its v1 history from the bundled
 * `content/lelanea_slot_taxonomy.json`, then asks Daybreak's global slot sync
 * to project the result into `framework_slot_definition` as `scope = global`.
 *
 * ## The rows this writes, and who owns them (`fp4`)
 *
 * **Operator-owned.** Written once, while the table is empty, and never again.
 * Emptiness is the marker because the definitions and their revisions land in
 * one transaction: any row present means this has run, whatever an admin has
 * done since. So a re-run after an admin **retired** a slot does not revive it,
 * and one after an admin **reworded** a description does not undo the edit — a
 * per-slug "create if absent" would get the first of those wrong, since a
 * retired row is still a row.
 *
 * A slot later added to the file therefore does not reach a seeded database.
 * That is deliberate: once seeded, the tables are the taxonomy and the editor
 * (t-71) is how a slot is added. The file is not a fallback at read time —
 * `lib/app/slots/taxonomy-store.ts` explains why it must not be.
 *
 * **Safe on empty.** It only ever adds rows. No removal pass, at either tier:
 * the framework's global pass writes nothing when the provider returns nothing.
 *
 * **Idempotent.** The second run reads one row, writes none, and still re-syncs
 * — the sync is itself guarded by a field diff, so it writes nothing when
 * nothing changed.
 *
 * ## Why it calls the sync itself
 *
 * On a fresh database `prisma/seeds/_framework/000-framework-boot.ts` runs
 * BEFORE this unit (see its docblock on the `_framework/` ordering), so the
 * boot-time global pass finds an empty table and correctly writes nothing.
 * Without the call below, `framework_slot_definition` would hold no global row
 * until the next server boot — and `db:reset` in CI never boots a server. The
 * seam exists to be called again when the source changes (t-69); the seed
 * changing it is the first such caller.
 *
 * The provider is registered here rather than relied on, for the same reason:
 * `000-framework-boot.ts` is skipped on an incremental `db:seed`, so on an
 * existing dev database nothing has registered it and the sync below would find
 * `no_provider` and write nothing. `initLeafApp()` is the registration and is a
 * pure, idempotent one (its own docblock requires that of everything in it), so
 * calling it directly is enough. NOT `syncFrameworkForSeed()`, which
 * `001-journey-map.ts` needs because it depends on framework `Module` rows: this
 * unit depends on none, and the heavier call adds its documented
 * `duplicate slug — last registration wins` warnings to every seed run for
 * nothing.
 *
 * No `hashInputs` over the JSON, deliberately. Editing the file must not
 * re-run a unit that short-circuits on a seeded database — it would read one
 * row and do nothing, while implying the edit had landed.
 *
 * @see lib/app/content/slot-taxonomy.ts — the bundled file
 * @see lib/app/slots/taxonomy-store.ts — the provider the sync calls
 * @see .context/app/slots.md
 */

import type { SeedUnit } from '@/prisma/runner';
import { getSlotTaxonomy } from '@/lib/app/content/slot-taxonomy';
import { SLOT_DEFINITION_FIELDS } from '@/lib/app/slots/taxonomy-store';
import { initLeafApp } from '@/lib/app/leaf-bootstrap';
import { syncGlobalSlotDefinitions } from '@/lib/framework/data-slots';

const unit: SeedUnit = {
  name: 'app-lelanea/011-slot-taxonomy',
  async run({ prisma, logger }) {
    // Registers the global slot provider the sync at the bottom reads. See the
    // docblock: the boot unit that would otherwise have done it is skipped on an
    // incremental seed.
    await initLeafApp();

    const existing = await prisma.appSlotDefinition.findFirst({
      select: { slug: true },
    });
    if (existing) {
      const [total, active] = await Promise.all([
        prisma.appSlotDefinition.count(),
        prisma.appSlotDefinition.count({ where: { isActive: true } }),
      ]);
      logger.info(
        `⏭  Slot taxonomy already in the database (${total} definitions, ${active} active); left as they are`
      );
    } else {
      const file = getSlotTaxonomy();
      const now = new Date();

      await prisma.$transaction([
        prisma.appSlotDefinition.createMany({
          data: file.slots.map((slot) => ({
            slug: slot.slug,
            group: slot.group,
            description: slot.description,
            visibility: slot.visibility,
            mode: slot.mode,
            dataType: slot.dataType,
            sensitivity: slot.sensitivity,
            priorityWeight: slot.priorityWeight,
            isActive: true,
            version: 1,
            createdAt: now,
            updatedAt: now,
          })),
          skipDuplicates: true,
        }),
        prisma.appSlotDefinitionRevision.createMany({
          data: file.slots.map((slot) => ({
            slotSlug: slot.slug,
            version: 1,
            group: slot.group,
            description: slot.description,
            visibility: slot.visibility,
            mode: slot.mode,
            dataType: slot.dataType,
            sensitivity: slot.sensitivity,
            priorityWeight: slot.priorityWeight,
            isActive: true,
            // Against nothing, everything is new. The editor's history view
            // reads v1 as the creation rather than as a change to eight fields.
            changedFields: [...SLOT_DEFINITION_FIELDS],
            origin: 'seed' as const,
            // The operator wrote this, not a person. `origin` is what says so —
            // a null `editorId` alone would be ambiguous with an erased admin.
            editorId: null,
            changedAt: now,
          })),
          skipDuplicates: true,
        }),
      ]);

      const hidden = file.slots.filter((s) => s.visibility === 'hidden').length;
      logger.info(
        `🧬 Seeded the slot taxonomy: ${file.slots.length} definitions in ${file.groups.length} groups (${hidden} hidden), each at v1 (${file.taxonomy.provenance.status})`
      );
    }

    // Project into `framework_slot_definition`, on both paths: a fresh seed has
    // rows the boot pass could not see, and a re-run repairs a database where
    // the projection was lost (a framework table restored from an older dump).
    // Throws on failure rather than warning — a seed that reports success while
    // the taxonomy reached no agent is the failure this is guarding against.
    const result = await syncGlobalSlotDefinitions();
    if (result.status === 'synced') {
      logger.info(
        `🔗 Global slot sync: ${result.provided} provided, ${result.created} created, ${result.updated} updated, ${result.deactivated} deactivated`
      );
    } else {
      logger.info(`🔗 Global slot sync: nothing written (${result.status})`);
    }
  },
};

export default unit;
