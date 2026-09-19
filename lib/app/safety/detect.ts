/**
 * Does this message say someone may be in danger? Deterministic, and first
 * (f-safety t-58; product description §8.1, §12).
 *
 * Before this, a person telling her they wanted to end their life got whatever
 * the model said, and nothing at all when the model was down. The detection
 * therefore must not depend on a model: it is a phrase list over normalised
 * text, run before the turn is claimed, before the pause check, and before any
 * model is called.
 *
 * ## Two tiers (owner ruling, 19 Sept 2026)
 *
 * | Tier   | Means                                                     | The turn                                  |
 * | ------ | --------------------------------------------------------- | ----------------------------------------- |
 * | `hard` | unambiguous danger: suicide, self-harm, harming another, immediate risk | is answered with the resource; no model |
 * | `soft` | distress that may be danger                               | the resource goes first, then she answers |
 * | `none` | nothing matched                                           | runs as it always did                     |
 *
 * **The list errs towards `hard`.** A negation ("I'm not going to kill myself")
 * still matches, because a phrase list cannot read intent and a miss is the
 * failure that matters. The one exception is hurting another person, where the
 * negated form is ordinary speech — see the pattern. The context check (`context-check.ts`) exists to take
 * the over-reaction back out — it can move `hard` to `soft`, never further, so
 * the resource is shown either way.
 *
 * **Idiom is kept out by shape, not by an allowlist.** "This job is killing
 * me", "I could kill for a coffee", "dying to know" match nothing, because every
 * hard phrase names the self or another person as the object of the harm.
 *
 * **Normalised the way the platform's input guard normalises** (zero-width
 * characters stripped, whitespace collapsed, NFC), plus case and curly
 * apostrophes — its approach, not its patterns. The patterns tolerate missing
 * spaces ("killmyself") because stripping a zero-width joiner leaves exactly
 * that.
 *
 * **What a detection returns is categories, never the words.** It is what the
 * safety record stores, and a record of the event must not become a copy of
 * the message.
 *
 * @see lib/app/safety/assess.ts — what a turn does with the answer
 * @see .context/app/safety.md
 */

export type CrisisTier = 'none' | 'soft' | 'hard';

/** What was matched, by kind. Stored on the safety record in place of the words. */
export type CrisisCategory =
  'suicide' | 'self_harm' | 'harm_to_others' | 'immediate_risk' | 'distress';

export interface CrisisDetection {
  tier: CrisisTier;
  /** Every category that matched, in a stable order. Empty for `none`. */
  categories: CrisisCategory[];
}

interface Pattern {
  category: CrisisCategory;
  regex: RegExp;
}

// `\s*` wherever a word boundary sits inside a phrase, so a stripped zero-width
// character or a missing space ("killmyself") cannot step around a match.
const MY_SELF = String.raw`my\s*self`;

const OTHERS = String.raw`(?:him|her|them|someone|somebody|my\s*(?:wife|husband|partner|mum|mom|dad|mother|father|boss|son|daughter|child|kids?|baby|brother|sister))\b`;

const HARD: readonly Pattern[] = [
  { category: 'suicide', regex: new RegExp(String.raw`\bkill(?:ing)?\s*${MY_SELF}`) },
  { category: 'suicide', regex: /\bsuicid(?:e|al)\b/ },
  { category: 'suicide', regex: /\bend(?:ing)?\s*(?:my\s*(?:own\s*)?life|it\s*all)\b/ },
  { category: 'suicide', regex: /\btak(?:e|ing)\s*my\s*(?:own\s*)?life\b/ },
  { category: 'suicide', regex: /\b(?:want|wanna|ready)\s*(?:to\s*)?die\b/ },
  { category: 'suicide', regex: /\bwish\s*i\s*(?:was|were)\s*dead\b/ },
  { category: 'suicide', regex: /\bbetter\s*off\s*dead\b/ },
  { category: 'suicide', regex: /\bno\s*reason\s*to\s*(?:live|be\s*alive)\b/ },
  {
    category: 'suicide',
    regex: /\bdon'?t\s*want\s*to\s*(?:live|be\s*alive)\b/,
  },
  {
    category: 'suicide',
    regex: /\bjump\s*(?:off|from)\s*(?:a|the|this)\s*(?:bridge|building|roof|cliff)\b/,
  },
  {
    category: 'self_harm',
    regex: new RegExp(
      String.raw`\b(?:hurt|harm|cut|cutting|burn|burning|hurting|harming)\s*${MY_SELF}`
    ),
  },
  { category: 'self_harm', regex: /\bself[\s-]*harm(?:ing)?\b/ },
  { category: 'self_harm', regex: /\boverdos(?:e|ing)\b/ },
  // "Hurt" only with intent: "I don't want to hurt her feelings" is the most
  // ordinary sentence in a coaching conversation.
  {
    category: 'harm_to_others',
    regex: new RegExp(String.raw`\b(?:kill|stab|shoot|strangle)\s*${OTHERS}`),
  },
  {
    category: 'harm_to_others',
    regex: new RegExp(String.raw`\b(?:want|wanna|going|gonna)\s*to\s*kill\s*${OTHERS}`),
  },
  // The one place the list reads a negation: "I don't want to hurt him" is
  // said about feelings far more often than about harm, and a stated intent
  // to hurt someone still matches.
  {
    category: 'harm_to_others',
    regex: new RegExp(
      String.raw`(?<!\b(?:don'?t|do\s*not|never|wouldn'?t)\s*)\b(?:want|wanna|going|gonna)\s*to\s*hurt\s*${OTHERS}(?!'?s?\s*feelings)`
    ),
  },
  {
    category: 'immediate_risk',
    regex: /\b(?:going|gonna|trying)\s*to\s*(?:kill|hurt)\s*me\b/,
  },
  { category: 'immediate_risk', regex: /\bi'?m\s*(?:not\s*safe|in\s*danger)\b/ },
];

const SOFT: readonly Pattern[] = [
  { category: 'distress', regex: /\bcan'?t\s*(?:go\s*on|take\s*(?:it|this)\s*any\s*more)\b/ },
  { category: 'distress', regex: /\bwant\s*to\s*disappear\b/ },
  {
    category: 'distress',
    regex: /\bdon'?t\s*want\s*to\s*be\s*(?:here|around)\s*any\s*more\b/,
  },
  { category: 'distress', regex: /\b(?:no\s*one|nobody)\s*would\s*(?:miss|care)\b/ },
  { category: 'distress', regex: /\bbetter\s*off\s*without\s*me\b/ },
  { category: 'distress', regex: /\bno\s*point\s*(?:in\s*)?(?:anything|going\s*on|living)\b/ },
  {
    category: 'distress',
    regex: /\bfeel(?:s|ing)?\s*(?:so\s*|completely\s*|totally\s*)?hopeless\b/,
  },
];

const CATEGORY_ORDER: readonly CrisisCategory[] = [
  'suicide',
  'self_harm',
  'harm_to_others',
  'immediate_risk',
  'distress',
];

/**
 * Normalise a message for matching. The input guard's approach
 * (`lib/orchestration/chat/input-guard.ts`), extended with case, curly
 * apostrophes and compatibility forms (NFKC folds full-width letters).
 */
export function normaliseForCrisisScan(text: string): string {
  return (
    text
      .normalize('NFKC')
      // Zero-width characters and soft hyphens, which break a phrase apart invisibly.
      // eslint-disable-next-line no-misleading-character-class
      .replace(/[\u200B\u200C\u200D\u2060\uFEFF\u00AD]/g, '')
      .replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'")
      .replace(/[\s\u00A0\u2000-\u200A\u202F\u205F\u3000]+/g, ' ')
      .toLowerCase()
  );
}

function matching(patterns: readonly Pattern[], text: string): Set<CrisisCategory> {
  const found = new Set<CrisisCategory>();
  for (const { category, regex } of patterns) if (regex.test(text)) found.add(category);
  return found;
}

/**
 * The deterministic tier of a message.
 *
 * Pure and synchronous: no model, no database, no network — so it answers the
 * same way when every one of them is down.
 */
export function detectCrisisTier(text: string): CrisisDetection {
  const normalised = normaliseForCrisisScan(text);
  const hard = matching(HARD, normalised);
  const soft = matching(SOFT, normalised);
  const all = new Set([...hard, ...soft]);
  const categories = CATEGORY_ORDER.filter((c) => all.has(c));
  const tier: CrisisTier = hard.size > 0 ? 'hard' : soft.size > 0 ? 'soft' : 'none';
  return { tier, categories };
}
