/**
 * Dev only: give one account a realistic record in Lelañea's notes, so the
 * notes page has something to look at (f-slots t-73, t-79).
 *
 * Rows are written straight to `framework_slot_value` in the shape Daybreak's
 * value engine writes them — insert-only, `version` from 1 per slug, the
 * previous head stamped `supersededAt` — so the head read and the history read
 * see exactly what capture would leave. Not through `appendSlotValue` itself:
 * scripts may not import the framework tier (`no-restricted-imports`), and this
 * sets two things the engine deliberately does not let a caller set:
 *
 * - **`capturedAt` is spread over the last fortnight**, oldest first, so the
 *   `recent` sort and the dates on each card read like a real record rather
 *   than thirty rows written in the same second.
 * - **Art. 9 notes are stored as the sentinel**, the way masking-before-storage
 *   leaves them at capture — with the reasoning note unmasked, as Daybreak's
 *   `fill_slot` currently stores it (t-80). That is the case the search must
 *   not match.
 *
 * What it covers: every visible group, a note corrected by the person (two
 * versions), one revised twice (three versions — "1 older reading as well"),
 * two Art. 9 notes, two of Lelañea's own headings, and one HIDDEN
 * development-stage note that must never appear on the page.
 *
 * Idempotent by replacement: it deletes this account's slot values first, then
 * writes the set. It touches no other account and no other table.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/db/seed-dev-notes.ts <email>
 *
 * Refuses to run with NODE_ENV=production.
 */

import { prisma } from '@/lib/db/client';
import { redactedString } from '@/lib/security/redact';
import { CORRECTION_CONFIDENCE, CORRECTION_NOTE } from '@/lib/app/slots/notes';

interface Seed {
  slug: string;
  value: string;
  confidence: number;
  /** A `SLOT_SOURCE_TYPE` value — `direct`, `inferred`, `user_confirmed`, … */
  sourceType: string;
  reasoningNote: string;
  /** Art. 9: stored as the sentinel, as capture masking leaves it. */
  masked?: boolean;
}

const WITHHELD = redactedString('special_category');

/** In write order — oldest first. A slug appearing twice is a new version. */
const SEEDS: Seed[] = [
  {
    slug: 'current_circumstances',
    value:
      'You are six weeks into a new role leading a small team, after eight years as the one doing the work.',
    confidence: 9,
    sourceType: 'direct',
    reasoningNote: 'You said this plainly at the start of the first conversation.',
  },
  {
    slug: 'life_work',
    value: 'Work is going badly and you are thinking about leaving.',
    confidence: 4,
    sourceType: 'inferred',
    reasoningNote:
      'You mentioned dreading Mondays twice and wondered aloud what else you could do.',
  },
  {
    slug: 'aspirations',
    value: 'You want to be good at leading people, not just at the work itself.',
    confidence: 5,
    sourceType: 'built_across_turns',
    reasoningNote: 'You came back to what a good manager looked like three times in one session.',
  },
  {
    slug: 'directness_preference',
    value: 'You want things named plainly. Softening reads to you as being managed.',
    confidence: 9,
    sourceType: 'direct',
    reasoningNote: 'You asked Lelañea outright to stop cushioning things.',
  },
  {
    slug: 'disposition',
    value: 'Quick to laugh, slow to decide. You like to turn a thing over several times first.',
    confidence: 6,
    sourceType: 'emerged_naturally',
    reasoningNote:
      'You joked about taking a week to choose a sofa, then described doing the same with a job offer.',
  },
  {
    slug: 'life_family_strain',
    value:
      'You have not spoken to your brother since the summer, after an argument about your father’s care.',
    confidence: 8,
    sourceType: 'unprompted',
    reasoningNote: 'You brought this up yourself while talking about the weekend.',
  },
  {
    slug: 'life_physical_health',
    value: WITHHELD,
    masked: true,
    confidence: 7,
    sourceType: 'direct',
    reasoningNote: 'You mentioned the migraines getting worse since the new role started.',
  },
  {
    slug: 'pace_preference',
    value: 'You would rather sit with one thing properly than cover three.',
    confidence: 6,
    sourceType: 'inferred',
    reasoningNote: 'You slowed the conversation down twice when it started moving on.',
  },
  {
    slug: 'life_wealth_strain',
    value: 'Money is tight this month — the move cost more than you planned.',
    confidence: 8,
    sourceType: 'direct',
    reasoningNote: 'You said so when explaining why the course would have to wait.',
  },
  {
    slug: 'fears_avoidances',
    value: 'Being found out as not knowing what you are doing, now that people look to you.',
    confidence: 4,
    sourceType: 'inferred',
    reasoningNote: 'You wondered twice whether the team could tell you were improvising.',
  },
  {
    slug: 'aspirations',
    value:
      'You want to be the kind of manager you never had — someone who notices before it becomes a problem.',
    confidence: 7,
    sourceType: 'direct',
    reasoningNote: 'You said this almost word for word when talking about your first boss.',
  },
  {
    slug: 'support_available',
    value: 'Your partner, and an old colleague you call when work gets tangled.',
    confidence: 8,
    sourceType: 'direct',
    reasoningNote: 'You named both when asked who you talk things through with.',
  },
  {
    slug: 'life_transitions',
    value: 'You moved city in July, and are still finding your feet.',
    confidence: 9,
    sourceType: 'direct',
    reasoningNote: 'You said this plainly, and it came up again in passing.',
  },
  {
    slug: 'weekly_rhythm',
    value: 'Sunday walks are the one thing that reliably resets the week.',
    confidence: 6,
    sourceType: 'emerged_naturally',
    reasoningNote:
      'You mentioned the walks three times, each time as the point where things felt manageable again.',
  },
  {
    slug: 'challenge_tolerance',
    value: 'Pushback lands well when it comes with a question, not a verdict.',
    confidence: 5,
    sourceType: 'built_across_turns',
    reasoningNote: 'You took two challenges well and bristled at one that arrived as a conclusion.',
  },
  {
    slug: 'life_work',
    value: 'Work is hard right now, but you are not leaving. You want to get better at it.',
    confidence: CORRECTION_CONFIDENCE,
    sourceType: 'user_confirmed',
    reasoningNote: CORRECTION_NOTE,
  },
  {
    slug: 'motivational_drivers',
    value: 'Being useful to someone specific moves you far more than any target does.',
    confidence: 6,
    sourceType: 'synthesised',
    reasoningNote:
      'Drawn together from what you said about your team, your brother and your old job.',
  },
  {
    slug: 'life_emotional_health_strain',
    value: WITHHELD,
    masked: true,
    confidence: 5,
    sourceType: 'unprompted',
    reasoningNote: 'You said the evenings have felt heavy since the argument with your brother.',
  },
  {
    slug: 'values_named',
    value: 'Fairness, and keeping your word — even when it costs you.',
    confidence: 9,
    sourceType: 'direct',
    reasoningNote: 'You named both in the Values module and gave an example of each.',
  },
  {
    slug: 'strengths_capacities',
    value: 'You stay calm when other people are not, and they notice.',
    confidence: 5,
    sourceType: 'inferred',
    reasoningNote:
      'You described two tense meetings and, both times, you were the one who slowed it down.',
  },
  {
    slug: 'constraints_practical',
    value: 'Evenings are yours; weekends are mostly spoken for until the new flat is sorted.',
    confidence: 7,
    sourceType: 'direct',
    reasoningNote: 'You said this when Lelañea asked when you had time to think.',
  },
  {
    slug: 'development_stage',
    value: 'Early in examining patterns; strong vocabulary from work, little from inner life.',
    confidence: 5,
    sourceType: 'inferred',
    reasoningNote: 'HIDDEN — this must never appear on the notes page.',
  },
  {
    slug: 'aspirations',
    value:
      'To lead in a way your team would describe as steady — and to still like the work in five years.',
    confidence: 8,
    sourceType: 'direct',
    reasoningNote: 'You refined what you had said before, in your own words.',
  },
  {
    slug: 'self_story',
    value:
      'You describe yourself as the reliable one — the person who gets it done, not the one who decides.',
    confidence: 7,
    sourceType: 'emerged_naturally',
    reasoningNote:
      'You used the word “reliable” about yourself four times across two conversations.',
  },
  {
    slug: 'brother_repair',
    value: 'You would like to call your brother before his birthday in October, but not yet.',
    confidence: 6,
    sourceType: 'unprompted',
    reasoningNote: 'You raised this yourself at the end of a conversation about something else.',
  },
  {
    slug: 'commitments_made',
    value: 'One-to-ones with each person on the team, every fortnight, starting this week.',
    confidence: 9,
    sourceType: 'direct',
    reasoningNote: 'You decided this in the conversation and said you would put them in the diary.',
  },
  {
    slug: 'depth_preference',
    value: 'Short answers first; the full working only when you ask for it.',
    confidence: 6,
    sourceType: 'inferred',
    reasoningNote: 'You skimmed two longer replies and asked follow-ups on the short ones.',
  },
  {
    slug: 'life_relationships_strength',
    value: 'Your partner is the steady ground — you said you would be lost without them this year.',
    confidence: 8,
    sourceType: 'direct',
    reasoningNote: 'You said this when talking about the move.',
  },
];

const FORTNIGHT_MS = 14 * 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Refusing to seed notes in production.');
  const email = process.argv[2];
  if (!email) throw new Error('Usage: seed-dev-notes.ts <email>');

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`No account with email ${email}.`);

  const removed = await prisma.slotValue.deleteMany({ where: { userId: user.id } });

  // Oldest first, a fortnight ago to now, with a few hours' jitter.
  const start = Date.now() - FORTNIGHT_MS;
  const step = FORTNIGHT_MS / SEEDS.length;
  const versions = new Map<string, { id: string; version: number }>();

  for (const [index, seed] of SEEDS.entries()) {
    const capturedAt = new Date(start + index * step + (index % 3) * 3_600_000);
    const head = versions.get(seed.slug);
    if (head) {
      await prisma.slotValue.update({ where: { id: head.id }, data: { supersededAt: capturedAt } });
    }
    const row = await prisma.slotValue.create({
      data: {
        userId: user.id,
        slotSlug: seed.slug,
        version: head ? head.version + 1 : 1,
        value: seed.value,
        confidence: seed.confidence,
        sourceType: seed.sourceType,
        reasoningNote: seed.reasoningNote,
        provenance:
          seed.sourceType === 'user_confirmed' ? {} : { conversationId: `dev-seed-${index}` },
        capturedAt,
      },
      select: { id: true, version: true },
    });
    versions.set(seed.slug, row);
  }

  const heads = new Set(SEEDS.map((seed) => seed.slug)).size;
  process.stdout.write(
    `Removed ${removed.count} old values; wrote ${SEEDS.length} versions across ${heads} notes for ${email} ` +
      `(1 hidden, 2 Art. 9, 2 of Lelañea's own headings).\n`
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
