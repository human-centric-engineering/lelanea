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
 */

import { getFoundationalCollectionMeta } from '@/lib/app/content';

/**
 * A conservative BCP-47 shape: a 2–3 letter primary tag, then up to two
 * alphanumeric subtags. Wide enough for `en`, `en-GB`, `pt-BR` and `zh-Hant-TW`;
 * narrow enough to reject the free text an `Accept-Language` header can carry.
 */
const LANGUAGE_TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/i;

/** Longest header we will look at, so a pathological value costs nothing. */
const MAX_HEADER_LENGTH = 200;

/**
 * The locale to record for a request: the client's highest-weighted well-formed
 * tag, or the authored collection's locale when there is none.
 */
export function resolveJoinLocale(acceptLanguage: string | null): string {
  const fallback = getFoundationalCollectionMeta().locale;
  if (!acceptLanguage) return fallback;

  let best: string | null = null;
  let bestQ = -1;

  const entries = acceptLanguage.slice(0, MAX_HEADER_LENGTH).split(',');
  for (const entry of entries) {
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
