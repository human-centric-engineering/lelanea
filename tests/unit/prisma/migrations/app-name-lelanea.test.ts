/**
 * The migration that renames the app to Lelanea in databases that already
 * exist, while the person keeps her ñ (f-content-polish t-193).
 *
 * ## What this pins
 *
 * The migration renames every "Lelañea" in the seeded config except the
 * phrases in its `keep` array, which are hers: her name, her writing, her
 * material. The seed content files make the same call, by hand, phrase by
 * phrase. If the two disagree, an existing database ends up saying something
 * a fresh one does not.
 *
 * So this reads the `keep` array off the migration, runs the same rename over
 * every seed content file, and expects it to change nothing: every ñ left in
 * the content is one the migration also keeps. A ñ added to the content in
 * this task without a matching phrase would be renamed in existing databases
 * only, and fails here.
 *
 * The migration is frozen once applied. If the content changes later, the
 * answer is a new migration, never an edit to this one (see
 * `.context/app/database-changes.md`).
 *
 * @see prisma/migrations/20261119100000_app_name_lelanea/migration.sql
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SYNOPSIS_AGENT_DESCRIPTION,
  SYNOPSIS_AGENT_NAME,
} from '@/lib/app/journey-record/synopsis/agent';
import { SEARCH_PERSON_MEMORY_DEFINITION } from '@/lib/app/memory/search-capability';
import { SUGGEST_RESOURCE_DEFINITION } from '@/lib/app/resources/suggest';
import { VOICE_AGENT_SYSTEM_INSTRUCTIONS } from '@/lib/app/voice/fingerprint';
import { SET_LEANING_DEFINITION } from '@/lib/app/voice/leaning-capability';
import { leaningSlotDefinitions } from '@/lib/app/voice/leanings';
import { SET_REGISTER_DEFINITION } from '@/lib/app/voice/register-capability';
import { SEARCH_PERSON_MEMORY_IMPL } from '@/prisma/seeds/app-lelanea/024-search-person-memory';
import { SET_REGISTER_IMPL } from '@/prisma/seeds/app-lelanea/023-set-register';
import { SET_LEANING_IMPL } from '@/prisma/seeds/app-lelanea/025-set-leaning';
import { SUGGEST_RESOURCE_IMPL } from '@/prisma/seeds/app-lelanea/014-suggest-resource';
import { appNameKeepPhrases, renameAppName as rename } from '@/tests/helpers/app-name-rename';

const ROOT = process.cwd();

function seedContentFiles(): string[] {
  const dirs = ['content', 'seed-data/drafted'];
  return dirs.flatMap((dir) =>
    readdirSync(path.join(ROOT, dir))
      .filter((name) => name.endsWith('.json'))
      .map((name) => path.join(dir, name))
  );
}

describe('20261119100000_app_name_lelanea', () => {
  const keep = appNameKeepPhrases();

  it('keeps her name, and renames the app', () => {
    expect(keep).toContain('Lelañea Fulton');
    expect(rename('Welcome to Lelañea. Lelañea Fulton wrote it.', keep)).toBe(
      'Welcome to Lelanea. Lelañea Fulton wrote it.'
    );
    expect(rename('Coach Lelañea believes the Lelañea App can help.', keep)).toBe(
      'Coach Lelañea believes the Lelanea App can help.'
    );
  });

  it('lists longer phrases before the ones they contain', () => {
    keep.forEach((phrase, i) => {
      const earlier = keep.slice(0, i);
      for (const longer of keep.slice(i + 1)) {
        if (longer.includes(phrase)) {
          expect(earlier, `"${longer}" must come before "${phrase}"`).toContain(longer);
        }
      }
    });
  });

  it.each(seedContentFiles())('agrees with %s about which ñ are hers', (file) => {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    expect(rename(text, keep)).toBe(text);
  });

  // The migration also rewrites text the seed takes from code, not from a
  // content file: the guide's instructions, the synopsis seat, the capability
  // rows and the leaning data slots. The same agreement holds for each.
  it.each([
    ['VOICE_AGENT_SYSTEM_INSTRUCTIONS', VOICE_AGENT_SYSTEM_INSTRUCTIONS],
    ['SYNOPSIS_AGENT_NAME', SYNOPSIS_AGENT_NAME],
    ['SYNOPSIS_AGENT_DESCRIPTION', SYNOPSIS_AGENT_DESCRIPTION],
    ['SUGGEST_RESOURCE', JSON.stringify([SUGGEST_RESOURCE_DEFINITION, SUGGEST_RESOURCE_IMPL])],
    [
      'SEARCH_PERSON_MEMORY',
      JSON.stringify([SEARCH_PERSON_MEMORY_DEFINITION, SEARCH_PERSON_MEMORY_IMPL]),
    ],
    ['SET_REGISTER', JSON.stringify([SET_REGISTER_DEFINITION, SET_REGISTER_IMPL])],
    ['SET_LEANING', JSON.stringify([SET_LEANING_DEFINITION, SET_LEANING_IMPL])],
    ['leaningSlotDefinitions()', JSON.stringify(leaningSlotDefinitions())],
  ])('agrees with %s about which ñ are hers', (_name, text) => {
    expect(rename(text, keep)).toBe(text);
  });
});
