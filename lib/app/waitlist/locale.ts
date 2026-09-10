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
 * ## The parse is deliberately small
 *
 * `Accept-Language` is a q-weighted list and a full parser is a package. All
 * this needs is the first tag, because the header is already in the client's
 * preference order — `en-GB,en;q=0.9,fr;q=0.8` yields `en-GB`. A value that
 * does not look like a BCP-47 language tag is discarded rather than stored: the
 * header is caller-controlled input, and a column that will one day be compared
 * against a real locale should not accumulate whatever a scanner sends.
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
 * The locale to record for a request: the first well-formed tag the client
 * asked for, or the authored collection's locale when there is none.
 */
export function resolveJoinLocale(acceptLanguage: string | null): string {
  const fallback = getFoundationalCollectionMeta().locale;
  if (!acceptLanguage) return fallback;

  const first = acceptLanguage.slice(0, MAX_HEADER_LENGTH).split(',')[0]?.split(';')[0]?.trim();
  if (!first) return fallback;

  // `*` is the wildcard "any language will do", which is the absence of a
  // preference rather than a preference — the fallback is the honest answer.
  if (first === '*') return fallback;

  return LANGUAGE_TAG.test(first) ? first : fallback;
}
