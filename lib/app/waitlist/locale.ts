/**
 * Which language a joiner arrived in.
 *
 * ## There is no locale mechanism to read from, so this reads the request
 *
 * The site is single-locale today: `app/layout.tsx` hard-codes `lang="en"`,
 * nothing routes on a locale prefix, and the authored collection declares
 * `en-US`. Storing that constant on every row would be a column that looks like
 * data and is a copy of a literal — it could never tell anyone anything.
 *
 * What the column is actually for is provenance: when there IS a second locale,
 * whoever reads the list needs to know which one each person joined in. The one
 * honest source for that today is the request itself — the language the
 * visitor's own browser asked for. So that is what is stored, with the
 * collection's locale as the fallback when a client sends no preference (a
 * `curl`, a bot, a browser with the header stripped).
 *
 * ## The parse is small, but it does read the q-weights
 *
 * `Accept-Language` is a q-weighted list and a full parser is a package. An
 * earlier version here took the first tag and said so: *"the header is already
 * in the client's preference order"*. **It is not** — list order carries no
 * meaning in RFC 9110; `q` does, defaulting to 1. Browsers happen to emit the
 * two in agreement, which is exactly why the shortcut survives review and then
 * records `fr` for a client sending `fr;q=0.1,en;q=0.9`. In the one column whose
 * stated purpose is to say which locale a person joined in, that is the wrong
 * answer, and nothing downstream could ever notice.
 *
 * So: parse the tags, take the highest `q`, and keep list order only as the
 * tie-break it legitimately is. A value that does not look like a BCP-47
 * language tag is discarded rather than stored — the header is
 * caller-controlled input, and a column that will one day be compared against a
 * real locale should not accumulate whatever a scanner sends.
 *
 * The bound on the work is a COUNT of entries, never a slice of the string —
 * see `MAX_ENTRIES` for what truncating a header manufactures.
 */

import { getFoundationalCollectionMeta } from '@/lib/app/content';

/**
 * A conservative BCP-47 shape: a 2–3 letter primary tag, then up to two
 * alphanumeric subtags. Wide enough for `en`, `en-GB`, `pt-BR` and `zh-Hant-TW`;
 * narrow enough to reject the free text an `Accept-Language` header can carry.
 */
const LANGUAGE_TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/i;

/**
 * How many entries we will consider, so a pathological header costs nothing.
 *
 * A COUNT, not a character budget. `slice(0, 200)` was the first shape and it
 * cuts at a byte offset rather than an entry boundary, so it can invent a tag
 * the client never sent: a boundary landing inside `zh-Hant-TW` yields
 * `zh-Hant`, which passes the tag test and is stored as if it had been asked
 * for. A boundary inside `;q=0.85` yields `q=0.`, which `parseFloat` reads as
 * `0` — so the client's STRONGEST preference is scored as an explicit refusal
 * and the row falls back to the collection locale. Both are wrong answers in
 * the one column whose job is provenance, and nothing downstream could notice.
 *
 * Splitting first and capping the count gives the same protection without
 * inventing anything: every entry considered is one the client actually sent.
 */
const MAX_ENTRIES = 24;

/** Longest single entry worth parsing — a real one is a tag plus `;q=0.x`. */
const MAX_ENTRY_LENGTH = 64;

/**
 * The locale to record for a request: the client's highest-weighted well-formed
 * tag, or the authored collection's locale when there is none.
 */
export function resolveJoinLocale(acceptLanguage: string | null): string {
  const fallback = getFoundationalCollectionMeta().locale;
  if (!acceptLanguage) return fallback;

  let best: string | null = null;
  let bestQ = -1;

  const entries = acceptLanguage.split(',', MAX_ENTRIES);
  for (const entry of entries) {
    // A single entry longer than any real one is skipped whole rather than
    // truncated — truncating is what manufactures a tag nobody sent.
    if (entry.length > MAX_ENTRY_LENGTH) continue;

    const [rawTag, ...params] = entry.split(';');
    const tag = rawTag?.trim() ?? '';

    // `*` is "any language will do", which is the absence of a preference
    // rather than a preference — the fallback is the honest answer to it.
    if (tag === '' || tag === '*' || !LANGUAGE_TAG.test(tag)) continue;

    const q = parseQuality(params);
    // Strictly greater, so an equal weight keeps the earlier tag: list order is
    // the tie-break, which is the only job it legitimately has.
    if (q > bestQ) {
      best = tag;
      bestQ = q;
    }
  }

  // `q=0` means "explicitly not this one", so a header offering nothing else
  // has offered nothing.
  return best !== null && bestQ > 0 ? best : fallback;
}

/**
 * The `q` of one entry's parameters, defaulting to 1 as RFC 9110 does.
 *
 * A malformed or out-of-range weight is treated as 0 rather than as the default
 * — a client that sent `q=banana` has not expressed a preference, and reading
 * it as the STRONGEST possible one would let a junk parameter outrank a real
 * tag.
 */
function parseQuality(params: string[]): number {
  for (const param of params) {
    const [key, value] = param.split('=');
    if (key?.trim().toLowerCase() !== 'q') continue;
    const q = Number.parseFloat(value ?? '');
    return Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0;
  }
  return 1;
}
