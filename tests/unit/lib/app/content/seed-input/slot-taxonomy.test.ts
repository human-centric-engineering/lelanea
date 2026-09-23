/**
 * The bundled slot taxonomy parses, and says what the seed will write
 * (f-slots t-70).
 *
 * The real file is parsed first, for the reason `schemas.test.ts` gives: a
 * content mistake has to be a red CI run rather than a throw at boot, and the
 * boot seam deliberately registers the provider BEFORE anything that can throw.
 *
 * **What the FILE SHAPE must reject** lives in
 * `tests/unit/lib/app/slots/taxonomy-file.test.ts`, beside the schema it
 * exercises. The two were one file until t-89 split the schema out of the
 * module that imports the JSON — the split that stopped 60KB of taxonomy
 * riding into six admin routes behind `definitions-admin.ts`.
 *
 * @see lib/app/content/seed-input/slot-taxonomy.ts
 * @see lib/app/slots/taxonomy-file.ts — the shape, and its own test
 */

import { describe, it, expect } from 'vitest';

import { getSlotTaxonomy, readableSlotGroups } from '@/lib/app/content/seed-input/slot-taxonomy';
import {
  SLOT_VISIBILITY,
  SLOT_MODE,
  SLOT_SENSITIVITY,
  SLOT_DATA_TYPE,
} from '@/lib/framework/data-slots';

describe('the bundled taxonomy', () => {
  it('parses, and is frozen and memoised like the rest of the content', () => {
    const file = getSlotTaxonomy();
    expect(file.taxonomy.id).toBe('lelanea_slot_taxonomy');
    expect(file.slots.length).toBeGreaterThan(0);
    expect(Object.isFrozen(file)).toBe(true);
    expect(Object.isFrozen(file.slots)).toBe(true);
    expect(getSlotTaxonomy()).toBe(file);
  });

  it('ships as a draft awaiting the owner, and says who', () => {
    // The v1 list is a PROPOSAL (t-70). If this ever reads `signed_off` it is
    // because the owner signed it off, not because the check was relaxed.
    const { provenance } = getSlotTaxonomy().taxonomy;
    expect(['draft', 'signed_off']).toContain(provenance.status);
    expect(provenance.awaitingSignOffFrom.length).toBeGreaterThan(0);
    expect(provenance.note.length).toBeGreaterThan(0);
  });

  it('declares every slug once, and every group it uses', () => {
    const file = getSlotTaxonomy();
    const slugs = file.slots.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    const declared = new Set(file.groups.map((g) => g.key));
    const used = new Set(file.slots.map((s) => s.group));
    expect([...used].filter((g) => !declared.has(g))).toEqual([]);
    expect([...declared].filter((g) => !used.has(g))).toEqual([]);
  });

  it('uses only classifiers the framework recognises', () => {
    // The store drops a row whose classifier it does not recognise, so a bad
    // value here would not crash anything — it would silently shrink the
    // taxonomy the agent is given. Caught in the file instead.
    for (const slot of getSlotTaxonomy().slots) {
      expect(Object.values(SLOT_VISIBILITY)).toContain(slot.visibility);
      expect(Object.values(SLOT_MODE)).toContain(slot.mode);
      expect(Object.values(SLOT_DATA_TYPE)).toContain(slot.dataType);
      expect(Object.values(SLOT_SENSITIVITY)).toContain(slot.sensitivity);
    }
  });

  it('blanks out nothing by default: the health slots are sensitive, none special_category', () => {
    // Owner ruling of 21 Sept 2026 (t-84, journal on f-slots): feelings are what
    // the app is for, so what someone says about their health is kept, shown
    // and correctable (`sensitive`) rather than masked before storage
    // (`special_category`). An operator can still mark a slot special_category
    // in Admin → Data slots; the file just never ships one.
    const file = getSlotTaxonomy();
    const health = file.slots.filter((s) =>
      /^life_(physical|emotional|spiritual)_health/.test(s.slug)
    );
    expect(health).toHaveLength(9);
    expect(health.every((s) => s.sensitivity === SLOT_SENSITIVITY.sensitive)).toBe(true);
    expect(file.slots.filter((s) => s.sensitivity === SLOT_SENSITIVITY.special_category)).toEqual(
      []
    );
  });

  it('hides the whole development group, and hides nothing else by accident', () => {
    // §12: where someone sits in examining their own conditioning is a tuning
    // signal for pace and register, and must never be ranked, scored or shown
    // as a level. `visibility: hidden` is the mechanism, so the group is
    // asserted in BOTH directions — a development slot that became `open` would
    // reach a member's profile panel, and an unrelated slot that became
    // `hidden` would be withheld from the person it is about for no reason.
    const file = getSlotTaxonomy();
    const development = file.slots.filter((s) => s.group === 'development');
    expect(development.length).toBeGreaterThan(0);
    expect(development.every((s) => s.visibility === 'hidden')).toBe(true);

    const hiddenElsewhere = file.slots.filter(
      (s) => s.visibility === 'hidden' && s.group !== 'development'
    );
    expect(hiddenElsewhere).toEqual([]);
  });

  it('keeps every group wholly open or wholly hidden, which is what makes the read allowlist lossless', () => {
    // Her `get_state` allowlist filters by GROUP — Daybreak's exposure facet
    // has no per-slot axis (f-slots t-72). So `readableSlotGroups()` can only
    // be honest while no group mixes the two: a mixed group would either
    // withhold its open slots from her or read its hidden one back, and which
    // of those happened would depend on a rule nobody chose.
    //
    // This is the assertion that has to fail FIRST, before the derivation
    // quietly does the wrong thing. It is stricter than the case above, which
    // pins today's taxonomy; this one holds for any taxonomy.
    const file = getSlotTaxonomy();
    for (const group of file.groups) {
      const visibilities = new Set(
        file.slots.filter((s) => s.group === group.key).map((s) => s.visibility)
      );
      expect(visibilities.size, `group "${group.key}" mixes open and hidden slots`).toBe(1);
    }
  });

  it('offers her back every group but the hidden one', () => {
    // Derived, never typed out — the point being that marking a slot hidden is
    // the whole act. Both directions, so a derivation that returned everything
    // (or nothing) fails.
    const groups = readableSlotGroups();
    expect(groups).not.toContain('development');
    expect(new Set(groups)).toEqual(
      new Set(
        getSlotTaxonomy()
          .groups.map((g) => g.key)
          .filter((key) => key !== 'development')
      )
    );
  });

  it('declares every slot pre-declared — open-mode slugs are minted, not authored', () => {
    // A definition row IS the pre-declaration, so `mode: open` on one would be
    // a contradiction: open-mode capture mints a slug with no backing row.
    expect(getSlotTaxonomy().slots.every((s) => s.mode === 'targeted')).toBe(true);
  });
});

