/**
 * The deterministic crisis tiers (f-safety t-58).
 *
 * Hypothesis (a) of the task: a phrase list plus normalisation gives zero
 * hard-tier misses on a written case set, and does not put the golden set's
 * anxious-not-in-danger case in the hard tier. Every table below is asserted
 * non-empty first, so an empty case list cannot pass for free (`fp6`).
 *
 * FORK NOTE — this reads the real `lib/app/content` golden set, not a mock:
 * the anxious-not-in-danger case is only a guarantee about the prompt that is
 * actually authored. Re-authoring the golden set can fail the golden-set case
 * here; if its `asked-for-a-diagnosis` key moves, point the lookup at the new one.
 */

import { describe, it, expect } from 'vitest';

import { getVoiceGoldenSet } from '@/lib/app/content/seed-input/voice-golden-set';
import { detectCrisisTier, normaliseForCrisisScan } from '@/lib/app/safety/detect';

const HARD: ReadonlyArray<[string, string]> = [
  ['I want to kill myself', 'suicide'],
  ["I've been thinking about killing myself", 'suicide'],
  ['I think about suicide every day', 'suicide'],
  ["I'm feeling suicidal", 'suicide'],
  ['I just want to end it all', 'suicide'],
  ["I'm going to end my life tonight", 'suicide'],
  ['I want to take my own life', 'suicide'],
  ['I want to die', 'suicide'],
  ['honestly I wish I was dead', 'suicide'],
  ['everyone says I would be better off dead', 'suicide'],
  ["I don't want to live anymore", 'suicide'],
  ["There's no reason to live", 'suicide'],
  ["I'm going to jump off the bridge", 'suicide'],
  ['I keep cutting myself', 'self_harm'],
  ['I want to hurt myself', 'self_harm'],
  ['I have been self-harming again', 'self_harm'],
  ['I took an overdose', 'self_harm'],
  ["I'm going to kill him", 'harm_to_others'],
  ['I want to hurt my husband', 'harm_to_others'],
  ['I am going to hurt her', 'harm_to_others'],
  ['I want to shoot him', 'harm_to_others'],
  ['I do not want to be alive', 'suicide'],
  ['I do not want to live any more', 'suicide'],
  ["I'm in danger", 'immediate_risk'],
  // Found by the second /code-review: the first round's narrowing had dropped each of these.
  ["I don't want to live with this pain anymore", 'suicide'],
  ["I don't want to live with myself after what I did", 'suicide'],
  ["I don't want to live on like this", 'suicide'],
  ['gonna shoot him and then myself', 'harm_to_others'],
  ["I'll shoot him tomorrow", 'harm_to_others'],
  ['I will shoot my boss', 'harm_to_others'],
  ["I've been cutting myself up again", 'self_harm'],
  ['I want to shoot myself', 'suicide'],
  ["I'm gonna hurt her", 'harm_to_others'],
  ["He's going to kill me", 'immediate_risk'],
  ["I'm not safe at home", 'immediate_risk'],
];

const SOFT: readonly string[] = [
  "I can't go on like this",
  "I can't take it anymore",
  'Sometimes I just want to disappear',
  "I don't want to be here anymore",
  'Nobody would miss me',
  'They would all be better off without me',
  'I feel so hopeless',
];

/** Idiom and ordinary coaching talk. None of these may raise anything. */
const NONE: readonly string[] = [
  'This job is killing me',
  'I could kill for a coffee right now',
  "I'm dying to know what you think",
  "I'm dead tired after this week",
  'I absolutely killed it in the presentation',
  "I don't want to hurt her feelings",
  "I'd never want to hurt him",
  "I'm hopeless at cooking",
  'My mum will kill me if I forget her birthday',
  'I want to grow into the person I am becoming',
  // Found by /code-review: each of these was hard before the patterns read what follows.
  'I need to cut myself some slack',
  "I'm burning myself out at work",
  'That really hurt my self-esteem',
  "I'll shoot him an email this afternoon",
  'My plan is to kill them with kindness',
  "I don't want to live in London any more",
  "I'm in danger of missing the deadline",
];

describe('detectCrisisTier', () => {
  it('puts every written hard case in the hard tier, under the right category', () => {
    expect(HARD.length).toBeGreaterThan(15);
    for (const [text, category] of HARD) {
      const result = detectCrisisTier(text);
      expect({ text, tier: result.tier }).toEqual({ text, tier: 'hard' });
      expect(result.categories).toContain(category);
    }
  });

  it('puts every written soft case in the soft tier, never hard', () => {
    expect(SOFT.length).toBeGreaterThan(5);
    for (const text of SOFT) {
      expect({ text, ...detectCrisisTier(text) }).toEqual({
        text,
        tier: 'soft',
        categories: ['distress'],
      });
    }
  });

  it('raises nothing for idiom or ordinary talk', () => {
    expect(NONE.length).toBeGreaterThan(5);
    for (const text of NONE) {
      expect({ text, ...detectCrisisTier(text) }).toEqual({ text, tier: 'none', categories: [] });
    }
  });

  it("does not put the golden set's anxious-not-in-danger case in the hard tier", () => {
    const anxious = getVoiceGoldenSet().prompts.find((p) => p.key === 'asked-for-a-diagnosis');
    expect(anxious?.prompt).toMatch(/anxious/);
    expect(detectCrisisTier(anxious?.prompt ?? '').tier).not.toBe('hard');
  });

  it('prefers hard when a message carries both tiers, and lists every category', () => {
    const result = detectCrisisTier("I can't go on. I want to kill myself.");
    expect(result).toEqual({ tier: 'hard', categories: ['suicide', 'distress'] });
  });

  it('still matches a negation — the context check, not the list, reads intent', () => {
    expect(detectCrisisTier("I'm not going to kill myself, don't worry").tier).toBe('hard');
  });

  describe('normalisation', () => {
    it.each([
      ['a zero-width joiner inside the phrase', 'kill\u200Dmyself'],
      ['a zero-width space between the words', 'kill\u200B my\u200Bself'],
      ['a soft hyphen', 'sui\u00ADcide'],
      ['full-width letters', '\uFF4B\uFF49\uFF4C\uFF4C myself'],
      ['shouting', 'I WANT TO KILL MYSELF'],
      ['a line break mid-phrase', 'I want to kill\nmyself'],
      ['a non-breaking space', 'kill\u00A0myself'],
    ])('does not let %s step around a hard match', (_label, text) => {
      expect(detectCrisisTier(text).tier).toBe('hard');
    });

    it('reads a curly apostrophe as a straight one', () => {
      expect(normaliseForCrisisScan('I don\u2019t')).toBe("i don't");
      expect(detectCrisisTier('I don\u2019t want to live').tier).toBe('hard');
    });
  });
});
