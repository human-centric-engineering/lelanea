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
  leaningsSentences,
  registerSentence,
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
  register: null,
  registerSource: null,
  leanings: null,
  recap: null,
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
  leaningChanges: [],
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

  it('says it looked at what is already understood, without naming a slot', () => {
    const parts = accountParts(input({ capabilities: ['get_state'] }));
    expect(parts).toEqual([
      {
        key: 'read_profile',
        line: 'Looked at what is already understood about you',
        detail: 'Looked at what is already understood about you.',
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
        line: 'Added something to what is understood about you',
        detail: 'Added something to what is understood about you. You can see it, and correct it.',
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

    expect(three[0].line).toBe('Added something to what is understood about you');
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
      'Looked something up in her material; Looked at what is already understood about you; Added something to what is understood about you'
    );
  });

  it('names a capability it has no words for rather than hiding it', () => {
    // A slug the agent's seat cannot call today. `get_state` used to stand here and now
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

  it('says a recap opened the session, and names what it drew on (f-recap t-142)', () => {
    const parts = accountParts(
      input({
        capabilities: ['search_knowledge_base'],
        turn: turn({
          recap: {
            since: '2026-09-18T09:00:00.000Z',
            words: 3,
            notes: ['life wealth', 'life family'],
            journey: 1,
          },
        }),
      })
    );

    // First: it is what the turn was.
    expect(parts[0]).toEqual({
      key: 'recap',
      line: 'Opened the session with a recap of the last one',
      detail:
        'Opened this session with a recap of the last one, drawing on 3 things you said last time; your notes on life wealth and life family; and where your journey has moved since.',
    });
    expect(parts[1]?.key).toBe('looked_up');
  });

  it('says one thing in the singular, and only what a recap drew on', () => {
    const parts = accountParts(
      input({ turn: turn({ recap: { since: 'x', words: 1, notes: [], journey: 0 } }) })
    );
    expect(parts[0]?.detail).toBe(
      'Opened this session with a recap of the last one, drawing on one thing you said last time.'
    );
  });

  it('sets the sources apart with semicolons when the notes are a list of their own', () => {
    const parts = accountParts(
      input({
        turn: turn({ recap: { since: 'x', words: 2, notes: ['a', 'b', 'c'], journey: 1 } }),
      })
    );
    expect(parts[0]?.detail).toBe(
      'Opened this session with a recap of the last one, drawing on 2 things you said last time; your notes on a, b, and c; and where your journey has moved since.'
    );
  });

  it('says nothing of a recap on a turn that was not one', () => {
    expect(accountParts(input()).map((part) => part.key)).not.toContain('recap');
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

describe('the register (f-registers t-125)', () => {
  it.each([
    [
      'teaching',
      'module',
      'Began in a teaching register: direct, and asking you to look further, where this part of the journey starts.',
    ],
    [
      'guiding',
      'module',
      'Began in a guiding register: gentle, and holding space, where this part of the journey starts.',
    ],
    [
      'guiding',
      'safety',
      'Began in a guiding register: gentle, and holding space, because something hard came up recently.',
    ],
    [
      'guiding',
      'asked',
      'Began in a guiding register: gentle, and holding space, because you asked for it.',
    ],
    ['teaching', null, 'Began in a teaching register: direct, and asking you to look further.'],
    // An unread crisis check: steered gently, and no reason claimed (code review).
    ['guiding', 'fallback', 'Began in a guiding register: gentle, and holding space.'],
  ] as const)('%s from %s', (register, registerSource, sentence) => {
    expect(registerSentence(turn({ register, registerSource }))).toBe(sentence);
  });

  it('says the ask was heard when the turn noted how to speak (t-126)', () => {
    const parts = accountParts(input({ capabilities: ['set_register'] }));

    expect(accountLine(parts)).toBe('Noted how you asked to be spoken to');
    expect(parts[0].detail).toMatch(/for the rest of this sitting/);
    // Named, so it is not the "Used set register" floor.
    expect(parts.map((part) => part.key)).toEqual(['noted_register']);
  });

  describe('a leaning changed in conversation (f-leanings t-137)', () => {
    const changed = (leaningChanges: AccountInput['leaningChanges']) =>
      accountParts(input({ capabilities: ['set_leaning'], leaningChanges }));

    it('names the pole, and says the person asked', () => {
      const parts = changed([{ leaning: 'length', from: 0, to: 1, how: 'asked' }]);

      expect(accountLine(parts)).toBe(
        'Moved your leaning a step toward concise and spare, as you asked'
      );
      expect(parts[0].detail).toBe(
        'Moved your leaning a step toward concise and spare, as you asked. It stays until you change it, here or in Settings.'
      );
      // Named, so it is not the "Used set leaning" floor.
      expect(parts.map((part) => part.key)).toEqual(['changed_leaning']);
    });

    it('says when it was a yes to a suggestion, not an ask', () => {
      const parts = changed([{ leaning: 'directness', from: 1, to: 2, how: 'agreed' }]);

      expect(accountLine(parts)).toBe(
        'Moved your leaning a step toward direct, when you agreed to the suggestion'
      );
      expect(accountLine(parts)).not.toMatch(/as you asked/);
    });

    it('says a return to rest from where it was', () => {
      const parts = changed([{ leaning: 'warmth', from: -2, to: 0, how: 'asked' }]);

      expect(accountLine(parts)).toBe(
        'Set your leaning back to rest from strongly toward empathetic and warm, as you asked'
      );
    });

    it('says the way it moved, not the side it landed on (code review)', () => {
      // Strongly verbose to verbose: still verbose, but a step toward concise,
      // which is what the person asked for.
      const parts = changed([{ leaning: 'length', from: -2, to: -1, how: 'asked' }]);

      expect(accountLine(parts)).toBe(
        'Moved your leaning a step toward concise and spare, as you asked'
      );
      expect(accountLine(changed([{ leaning: 'length', from: -2, to: -1, how: 'proposed' }]))).toBe(
        'Suggested moving your leaning a step toward concise and spare'
      );
    });

    it('says a dial asked back to rest was already there', () => {
      const parts = changed([{ leaning: 'directness', from: 0, to: 0, how: 'asked' }]);

      expect(accountLine(parts)).toBe('That leaning was already at rest');
    });

    it('says nothing moved when the dial was already as far as it goes, rather than claiming a change', () => {
      const parts = changed([{ leaning: 'questions', from: 1, to: 1, how: 'asked' }]);

      expect(accountLine(parts)).toBe('That leaning was already as far as it goes');
      expect(parts[0].detail).toBe(
        'That leaning was already as far as it goes, so nothing changed.'
      );
    });

    it('says a suggestion as one that changed nothing', () => {
      const parts = changed([{ leaning: 'length', from: 0, to: 1, how: 'proposed' }]);

      expect(accountLine(parts)).toBe(
        'Suggested moving your leaning a step toward concise and spare'
      );
      expect(parts[0].detail).toBe(
        'Suggested moving your leaning a step toward concise and spare. Nothing has changed unless you say yes.'
      );
    });

    it('still says something happened when the call answered but its outcome cannot be read', () => {
      const parts = changed([]);

      expect(accountLine(parts)).toBe('Changed, or suggested changing, one of your leanings');
      expect(parts[0].detail).toMatch(/in Settings/);
    });

    it('says each change, in order, when a turn made two', () => {
      const parts = changed([
        { leaning: 'length', from: 0, to: 1, how: 'asked' },
        { leaning: 'imagery', from: 0, to: 1, how: 'agreed' },
      ]);

      expect(accountLine(parts)).toBe(
        'Moved your leaning a step toward concise and spare, as you asked; Moved your leaning a step toward literal, when you agreed to the suggestion'
      );
    });
  });

  it('says it looked back when the turn searched what the person said before (t-130)', () => {
    const parts = accountParts(input({ capabilities: ['search_person_memory'] }));

    expect(accountLine(parts)).toBe('Looked back at what you’ve said before');
    // Named, so it is not the "Used search person memory" floor.
    expect(parts.map((part) => part.key)).toEqual(['looked_back']);
  });

  it('says nothing for a turn with no register, or no turn', () => {
    expect(registerSentence(turn())).toBeNull();
    expect(registerSentence(null)).toBeNull();
  });

  it('sits in the detail between what the turn did and what it cost, never in the line', () => {
    const data = input({ turn: turn({ register: 'teaching', registerSource: 'module' }) });
    const parts = accountParts(data);

    expect(accountLine(parts)).toBe(NOTHING_WRITTEN);
    expect(accountDetail(data, parts).split('\n')).toEqual([
      `${NOTHING_WRITTEN}.`,
      expect.stringMatching(/^Began in a teaching register/),
      expect.stringMatching(/^This turn used/),
    ]);
  });
});

describe('the leanings a reply was shaded by (f-leanings t-136)', () => {
  it('names each applied leaning by its pole, strongly where it was strong, in stamp order', () => {
    const sentences = leaningsSentences(
      turn({
        register: 'guiding',
        registerSource: 'module',
        leanings: {
          applied: [
            { key: 'devotion', stop: 1 },
            { key: 'length', stop: 2 },
            { key: 'directness', stop: -2 },
          ],
          held: [],
        },
      })
    );

    expect(sentences).toEqual([
      'Leaned the way you’ve set it: toward secular and plain, strongly toward concise and spare, and strongly toward gentle.',
    ]);
  });

  it('names a held leaning by the hard pole it leaned toward, and the crisis only when one was read', () => {
    const leanings = { applied: [], held: ['warmth' as const, 'pace' as const] };

    expect(leaningsSentences(turn({ registerSource: 'safety', leanings }))).toEqual([
      'Set aside your leanings toward cool and analytical and toward energetic for now, because something hard came up recently.',
    ]);
    // An unread crisis check holds them too, and claims no reason.
    expect(
      leaningsSentences(
        turn({ registerSource: 'fallback', leanings: { applied: [], held: ['directness'] } })
      )
    ).toEqual(['Set aside your leaning toward direct for now.']);
  });

  it('says a mild stop by its own name, not the strong one, where a label names both', () => {
    const said = (stop: 1 | 2) =>
      leaningsSentences(turn({ leanings: { applied: [{ key: 'directness', stop }], held: [] } }));

    expect(said(1)).toEqual(['Leaned the way you’ve set it: toward direct.']);
    expect(said(2)).toEqual([
      'Leaned the way you’ve set it: strongly toward direct and challenging.',
    ]);
  });

  it('does not say a pole that is never held was set aside', () => {
    expect(
      leaningsSentences(
        turn({ registerSource: 'safety', leanings: { applied: [], held: ['questions'] } })
      )
    ).toEqual([]);
  });

  it('says nothing for a turn that applied and held nothing, had no stamp, or no turn', () => {
    expect(leaningsSentences(turn({ leanings: { applied: [], held: [] } }))).toEqual([]);
    expect(leaningsSentences(turn())).toEqual([]);
    expect(leaningsSentences(null)).toEqual([]);
  });

  it('sits in the detail after the register and before the cost, never in the line', () => {
    const data = input({
      turn: turn({
        register: 'teaching',
        registerSource: 'module',
        leanings: { applied: [{ key: 'length', stop: 1 }], held: [] },
      }),
    });
    const parts = accountParts(data);

    expect(accountLine(parts)).toBe(NOTHING_WRITTEN);
    expect(accountDetail(data, parts).split('\n')).toEqual([
      `${NOTHING_WRITTEN}.`,
      expect.stringMatching(/^Began in a teaching register/),
      'Leaned the way you’ve set it: toward concise and spare.',
      expect.stringMatching(/^This turn used/),
    ]);
  });
});

describe('the time', () => {
  it('is a clock reading in the reader’s zone', () => {
    expect(accountTime('2026-09-19T12:00:05.000Z')).toMatch(/^\d{2}:\d{2}$/);
  });
});
