/**
 * The account under a reply, part by part (§10 t-66): plain words for what
 * the turn did, honest figures for what it cost, and nothing of the system's
 * vocabulary in the line a person skims.
 *
 * @see lib/app/conversation/account.ts
 */

import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_SOURCES,
  aboutTokens,
  accountDetail,
  accountLine,
  accountParts,
  accountTime,
  costSentence,
  NOTHING_WRITTEN,
  type AccountInput,
} from '@/lib/app/conversation/account';
import type { TurnAccount } from '@/lib/app/conversation/transcript';

const turn = (fields: Partial<TurnAccount> = {}): TurnAccount => ({
  turnId: 't1',
  seat: 'facilitator',
  status: 'completed',
  attempts: 1,
  modelId: 'gpt-4o-mini-2024-07-18',
  providerSlug: 'openai',
  fingerprintVersion: 'v1',
  inputTokens: 3_812,
  outputTokens: 240,
  costUsd: 0.0123,
  pricing: 'priced',
  errorCode: null,
  startedAt: '2026-09-19T12:00:00.000Z',
  completedAt: '2026-09-19T12:00:05.000Z',
  ...fields,
});

const citation = {
  marker: 1,
  chunkId: 'ch1',
  documentId: 'd1',
  documentName: 'On boundaries',
  contentHash: null,
  documentVersion: null,
  section: null,
  patternNumber: null,
  patternName: null,
  excerpt: 'A boundary is…',
  similarity: 0.9,
};

const input = (fields: Partial<AccountInput> = {}): AccountInput => ({
  at: '2026-09-19T12:00:05.000Z',
  capabilities: [],
  suggestions: [],
  citations: [],
  turn: turn(),
  ...fields,
});

describe('the parts', () => {
  it('says a search of her material in plain words, and how much of it the reply drew on', () => {
    const parts = accountParts(
      input({ capabilities: ['search_knowledge_base'], citations: [citation, citation] })
    );
    expect(parts).toEqual([
      {
        key: 'looked_up',
        line: 'Looked something up in her material',
        detail: 'Looked something up in her material and drew on 2 passages of it.',
      },
    ]);
    expect(accountLine(parts)).toBe('Looked something up in her material');
  });

  it('with nothing to say, says so honestly', () => {
    const parts = accountParts(input());
    expect(parts).toEqual([]);
    expect(accountLine(parts)).toBe(NOTHING_WRITTEN);
    expect(accountDetail(input(), parts)).toMatch(/^Nothing was written from this turn\./);
  });

  it('says she looked at what she already understands, without naming a slot', () => {
    const parts = accountParts(input({ capabilities: ['get_state'] }));
    expect(parts).toEqual([
      {
        key: 'read_profile',
        line: 'Looked at what she already understands about you',
        detail: 'Looked at what she already understands about you.',
      },
    ]);
  });

  it('says what it added to the profile, and that the person can correct it', () => {
    // The guardrail's own line: a capture is silent (D5), so without this the
    // turn would learn something and say nothing about having done so.
    const parts = accountParts(input({ capabilities: ['fill_slot'] }));
    expect(parts).toEqual([
      {
        key: 'wrote_profile',
        line: 'Added something to what she understands about you',
        detail:
          'Added something to what she understands about you. You can see it, and correct it.',
      },
    ]);
  });

  it('does not count the writes, because the frame cannot say how many things were learned', () => {
    // Three successful `fill_slot` calls can be fewer than three articles — the
    // model calling the tool twice for one slug inside one attempt is a case
    // `capture.ts` deliberately does not collapse, and a suppressed retry
    // returns a success like any other. "Added 3 things" where the panel shows
    // one item is a number the person would be right to distrust. Found by
    // /code-review.
    const three = accountParts(input({ capabilities: ['fill_slot', 'fill_slot', 'fill_slot'] }));
    const one = accountParts(input({ capabilities: ['fill_slot'] }));

    expect(three[0].line).toBe('Added something to what she understands about you');
    expect(three[0].line).toBe(one[0].line);
    expect(three[0].line).not.toMatch(/\d/);
  });

  it('reads what it consulted before what it wrote, in one line', () => {
    const parts = accountParts(
      input({
        capabilities: ['search_knowledge_base', 'get_state', 'fill_slot'],
        citations: [citation],
      })
    );
    expect(parts.map((part) => part.key)).toEqual(['looked_up', 'read_profile', 'wrote_profile']);
    expect(accountLine(parts)).toBe(
      'Looked something up in her material; Looked at what she already understands about you; Added something to what she understands about you'
    );
  });

  it('names a capability it has no words for rather than hiding it', () => {
    // A slug her seat cannot call today. `get_state` used to stand here and now
    // has a sentence of its own, which is the whole point of this floor: the day
    // a tool is granted before its words are written, it is named rather than
    // hidden.
    const parts = accountParts(
      input({ capabilities: ['request_transition', 'request_transition'] })
    );
    expect(parts).toEqual([
      {
        key: 'other_capability',
        line: 'Used request transition',
        detail: 'Used request transition.',
      },
    ]);
  });

  it('says what it pointed the person to, by the library’s title, never the model’s', () => {
    const parts = accountParts(
      input({
        capabilities: ['suggest_resource'],
        suggestions: [
          {
            id: 'on-stalling',
            kind: 'video',
            title: 'On stalling',
            subtitle: 'why',
            length: '5:04',
          },
        ],
      })
    );
    expect(parts).toEqual([
      {
        key: 'pointed_to',
        line: 'Pointed you to “On stalling”',
        detail: 'Pointed you to “On stalling” — a video of hers you can open beside this reply.',
      },
    ]);
  });

  it('joins two suggestions in one clause, and says what kinds they were', () => {
    const parts = accountParts(
      input({
        capabilities: ['suggest_resource', 'suggest_resource'],
        suggestions: [
          { id: 'a', kind: 'video', title: 'A', subtitle: 's', length: '1:00' },
          { id: 'b', kind: 'article', title: 'B', subtitle: 's', length: '2 min' },
        ],
      })
    );
    expect(parts[0]?.line).toBe('Pointed you to “A” and “B”');
    expect(parts[0]?.detail).toMatch(/a video and an article of hers/);
  });

  it('counts two of a kind as two, not as one', () => {
    const parts = accountParts(
      input({
        capabilities: ['suggest_resource', 'suggest_resource'],
        suggestions: [
          { id: 'a', kind: 'video', title: 'A', subtitle: 's', length: '1:00' },
          { id: 'b', kind: 'video', title: 'B', subtitle: 's', length: '2:00' },
        ],
      })
    );
    expect(parts[0]?.detail).toBe(
      'Pointed you to “A” and “B” — two videos of hers you can open beside this reply.'
    );
    const articles = accountParts(
      input({
        capabilities: ['suggest_resource'],
        suggestions: [
          { id: 'a', kind: 'article', title: 'A', subtitle: 's', length: '1 min' },
          { id: 'b', kind: 'article', title: 'B', subtitle: 's', length: '2 min' },
          { id: 'c', kind: 'video', title: 'C', subtitle: 's', length: '3:00' },
        ],
      })
    );
    expect(articles[0]?.detail).toMatch(/a video and two articles of hers/);
  });

  it('still says the turn offered something when the resource has since left the library', () => {
    // The trace says the call answered; the resolver found no such id. The
    // turn did something, and the account does not fall silent about it.
    const parts = accountParts(input({ capabilities: ['suggest_resource'], suggestions: [] }));
    expect(parts).toEqual([
      {
        key: 'pointed_to',
        line: 'Offered something that is no longer in her library',
        detail: 'Offered something that is no longer in her library.',
      },
    ]);
    // And never as an unnamed capability.
    expect(parts.some((p) => p.key === 'other_capability')).toBe(false);
  });

  it('reads what was offered after what was consulted and written', () => {
    const parts = accountParts(
      input({
        capabilities: ['fill_slot', 'suggest_resource', 'search_knowledge_base'],
        suggestions: [{ id: 'a', kind: 'video', title: 'A', subtitle: 's', length: '1:00' }],
      })
    );
    expect(parts.map((p) => p.key)).toEqual(['looked_up', 'wrote_profile', 'pointed_to']);
  });

  it('is composed from a list of sources — the seam §11 and §13 add to', () => {
    expect(ACCOUNT_SOURCES.length).toBeGreaterThan(0);
    for (const source of ACCOUNT_SOURCES) expect(typeof source).toBe('function');
  });
});

describe('the line contains no system language', () => {
  it('names neither the model nor the seat, though both are in the data', () => {
    const data = input({
      capabilities: ['search_knowledge_base', 'get_state', 'fill_slot'],
      citations: [citation],
    });
    // The population: both really are in the data.
    expect(data.turn?.modelId).toBe('gpt-4o-mini-2024-07-18');
    expect(data.turn?.seat).toBe('facilitator');
    const parts = accountParts(data);
    const line = accountLine(parts);
    const detail = accountDetail(data, parts);
    for (const text of [line, detail]) {
      expect(text).not.toContain('gpt-4o-mini');
      expect(text).not.toContain('facilitator');
      expect(text).not.toContain('search_knowledge_base');
      expect(text).not.toContain('fill_slot');
      expect(text).not.toContain('get_state');
    }
  });
});

describe('the figures', () => {
  it('rounds tokens to a size', () => {
    expect(aboutTokens(42)).toBe('about 42');
    expect(aboutTokens(160)).toBe('about 160');
    expect(aboutTokens(4_052)).toBe('about 4,100');
    expect(aboutTokens(12_345)).toBe('about 12,000');
  });

  it('a priced turn: tokens and dollars to the cent', () => {
    expect(costSentence(turn())).toBe('This turn used about 4,100 tokens and cost $0.01.');
    expect(costSentence(turn({ costUsd: 0.0006 }))).toBe(
      'This turn used about 4,100 tokens and cost less than a cent.'
    );
  });

  it('an unpriced turn never renders a dollar figure', () => {
    const sentence = costSentence(turn({ pricing: 'unpriced', costUsd: null }));
    expect(sentence).toBe('This turn used about 4,100 tokens and what it cost is not known.');
    expect(sentence).not.toMatch(/\$/);
    // And through the detail, with a part present.
    const data = input({
      capabilities: ['search_knowledge_base'],
      turn: turn({ pricing: 'unpriced', costUsd: null }),
    });
    expect(accountDetail(data, accountParts(data))).not.toMatch(/\$/);
  });

  it('a local model cost nothing to run — which is not the same as not known', () => {
    expect(costSentence(turn({ pricing: 'local', costUsd: null }))).toMatch(
      /cost nothing to run\.$/
    );
  });

  it('a live account — pricing unknown until the row — says the cost it was given, or nothing', () => {
    // As the hook builds it from `done`: pricing null, costUsd from the frame.
    expect(costSentence(turn({ pricing: null, costUsd: 0.0123 }))).toMatch(/cost \$0\.01\.$/);
    expect(costSentence(turn({ pricing: null, costUsd: null }))).toMatch(/not known\.$/);
    expect(
      costSentence(turn({ pricing: null, costUsd: null, inputTokens: null, outputTokens: null }))
    ).toBe('What it cost is not known.');
  });

  it('0/0 tokens — the provider reported no usage — is no figure, not "about 0"', () => {
    expect(
      costSentence(turn({ inputTokens: 0, outputTokens: 0, pricing: 'unpriced', costUsd: null }))
    ).toBe('What it cost is not known.');
    expect(costSentence(turn({ inputTokens: 0, outputTokens: 0 }))).toBe('Cost $0.01.');
  });

  it('no turn row, no figures', () => {
    expect(costSentence(null)).toBeNull();
    expect(accountDetail(input({ turn: null }), [])).toBe(`${NOTHING_WRITTEN}.`);
  });
});

describe('the detail', () => {
  it('reads as sentences, one to a line, what it did then what it cost', () => {
    const data = input({ capabilities: ['search_knowledge_base'], citations: [citation] });
    expect(accountDetail(data, accountParts(data))).toBe(
      'Looked something up in her material and drew on 1 passage of it.\n' +
        'This turn used about 4,100 tokens and cost $0.01.'
    );
  });
});

describe('the time', () => {
  it('is a clock reading in the reader’s zone', () => {
    expect(accountTime('2026-09-19T12:00:05.000Z')).toMatch(/^\d{2}:\d{2}$/);
  });
});
