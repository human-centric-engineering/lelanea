/**
 * The core reaches the prompt — on a turn where nothing was retrieved.
 *
 * This is the load-bearing test for §05 t-26. The claim it defends is not "the
 * projection returns three strings"; it is that **the turns where retrieval finds
 * nothing still sound like her**. A greeting, a refusal, a one-line clarifying
 * question — the first turns a new person reads — go out on the composed prompt
 * alone, so if the core is not in that string it is not anywhere.
 *
 * So the composition here is run exactly as the runtime runs it: the leaf's
 * projection → the row shape the seed writes → Sunrise's `resolveEffectivePrompt`
 * → `composeSystemPromptString`. Not the leaf's function in isolation, which
 * would pass with the profile unlinked.
 *
 * ## Every beat, verbatim, rather than a handful of pinned sentences
 *
 * The assertions walk the authored core and require each line to appear in the
 * prompt. That is deliberately stronger than pinning three quotations, and it
 * survives her editing her own words — which she is expected to do, since the
 * file is a draft awaiting her sign-off. It fails if a block is dropped from the
 * mapping, if beats are flattened into a paragraph, if a mode flips to override,
 * or if the profile stops being linked.
 *
 * ## "No knowledge retrieval in the path at all" is asserted, not assumed
 *
 * The last describe block reads the source of every module on the path and fails
 * if any of them reaches for the database or the knowledge layer. Composition
 * being independent of retrieval is the entire point of the feature; a comment
 * saying so would be worth nothing the day somebody wires a lookup in.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/content` seam
 * ---------------------------------------------------------------------------
 * The assertions walk Lelañea's authored core and require each of its beats to
 * survive into the composed prompt. A fork with its own core still passes
 * unchanged — nothing here pins her words — but a fork with NO voice fingerprint
 * has nothing for `getVoiceFingerprint()` to return and should delete this file
 * alongside the seam.
 *
 * What a fork should pin if it keeps the shape: the mapping table in
 * `lib/app/voice/fingerprint.ts`, and the "loses the whole core when the agent
 * is not linked" case. That second one is the load-bearing half — a prompt that
 * silently stops carrying identity still answers fluently, and sounds like
 * nobody.
 *
 * @see lib/app/voice/fingerprint.ts
 * @see lib/orchestration/agents/resolve-effective-prompt.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { getVoiceFingerprint } from '@/lib/app/content';
import {
  FINGERPRINT_VERSION_MARKER_PREFIX,
  VOICE_AGENT_SLUG,
  VOICE_AGENT_SYSTEM_INSTRUCTIONS,
  composeFingerprintProfileSections,
  fingerprintVersionMarker,
  readFingerprintVersion,
} from '@/lib/app/voice/fingerprint';
import { CORPUS_AGENT_SLUG_PREFIX } from '@/lib/app/voice/corpus-access';
import {
  composeSystemPromptString,
  resolveEffectivePrompt,
  type AgentPromptFields,
  type ProfilePromptFields,
} from '@/lib/orchestration/agents/resolve-effective-prompt';

const core = getVoiceFingerprint();

/** The profile row the seed writes, as the resolver reads it. */
function voiceProfile(): ProfilePromptFields {
  return {
    id: 'profile-voice-core',
    name: core.collection.title,
    ...composeFingerprintProfileSections(core),
  };
}

/**
 * The agent row the seed writes.
 *
 * All three inheritable columns NULL and all three modes at the platform default
 * — which is exactly the arrangement that makes the profile speak. Stated here
 * rather than hidden in a helper because it is the arrangement under test.
 */
function voiceAgent(): AgentPromptFields {
  return {
    systemInstructions: VOICE_AGENT_SYSTEM_INSTRUCTIONS,
    persona: null,
    brandVoiceInstructions: null,
    guardrails: null,
  };
}

/** What the model actually receives, with nothing retrieved. */
function composedPrompt(profile: ProfilePromptFields | null): string {
  return composeSystemPromptString(resolveEffectivePrompt(voiceAgent(), profile));
}

/** Every authored beat of the core, in one flat list. */
function everyBeat(): string[] {
  return [
    ...core.identity.lines,
    ...core.cadence.lines,
    ...core.grounding.lines,
    ...core.boundaries.lines,
    ...core.boundaries.howYouDecline,
  ];
}

describe('the composed prompt, with nothing retrieved', () => {
  it('is built from a core that is not empty', () => {
    // fp6: establish the population before anything is asserted about it. Every
    // `toContain` below passes for free against an empty beat list.
    expect(everyBeat().length).toBeGreaterThan(20);
  });

  it('carries who she is', () => {
    const prompt = composedPrompt(voiceProfile());

    expect(prompt).toContain(core.identity.heading);
    for (const line of core.identity.lines) expect(prompt).toContain(line);
  });

  it('carries how she grounds what she says', () => {
    const prompt = composedPrompt(voiceProfile());

    expect(prompt).toContain(core.grounding.heading);
    for (const line of core.grounding.lines) expect(prompt).toContain(line);
  });

  it('carries what she declines, and how she declines it', () => {
    // Two halves of one property. What she will not do is the easy half to
    // carry; the manner of the refusal is the half that makes a decline sound
    // like her rather than like a policy page.
    const prompt = composedPrompt(voiceProfile());

    expect(prompt).toContain(core.boundaries.heading);
    for (const line of core.boundaries.lines) expect(prompt).toContain(line);
    for (const line of core.boundaries.howYouDecline) expect(prompt).toContain(line);
  });

  it('carries how she sounds, with the words she avoids as well as the ones she reaches for', () => {
    const prompt = composedPrompt(voiceProfile());

    for (const line of core.cadence.lines) expect(prompt).toContain(line);
    expect(prompt).toContain(core.cadence.reachesFor.join(', '));
    expect(prompt).toContain(core.cadence.avoids.join(', '));
  });

  it('gives every beat its own line rather than flattening them into prose', () => {
    // The single-line cadence is authored, not an artifact of transcription.
    // Joining beats with a space would still satisfy every `toContain` above.
    const lines = new Set(composedPrompt(voiceProfile()).split('\n'));

    for (const beat of everyBeat()) expect(lines.has(beat)).toBe(true);
  });

  it('keeps the agent instructions, which are never inherited', () => {
    expect(composedPrompt(voiceProfile())).toContain(VOICE_AGENT_SYSTEM_INSTRUCTIONS);
  });
});

describe('the profile is what carries it', () => {
  it('loses the whole core when the agent is not linked to a profile', () => {
    // The failure this guards is quiet: an agent with no profile still answers,
    // still sounds fluent, and sounds like nobody. Reverting `profileId` in the
    // seed fails here.
    const linked = composedPrompt(voiceProfile());
    const unlinked = composedPrompt(null);

    // Guarded by the presence claim, so the absence claims below cannot pass on
    // an empty prompt.
    expect(linked).toContain(core.identity.lines[0]);
    for (const beat of everyBeat()) expect(unlinked).not.toContain(beat);
    expect(readFingerprintVersion(unlinked)).toBeNull();
  });

  it('still carries the agent instructions when unlinked, which is why the loss is quiet', () => {
    expect(composedPrompt(null)).toContain(VOICE_AGENT_SYSTEM_INSTRUCTIONS);
  });

  it('is overridden if the agent ever populates a column of its own', () => {
    // Not a bug — it is Sunrise's documented per-field resolution, with
    // `personaMode` defaulting to `override`. It is recorded here because it is
    // the one edit that silently removes her identity from every turn, and the
    // seed leaving those columns NULL is the thing standing between it and us.
    const agent: AgentPromptFields = { ...voiceAgent(), persona: 'You are a helpful assistant.' };
    const prompt = composeSystemPromptString(resolveEffectivePrompt(agent, voiceProfile()));

    expect(prompt).toContain('You are a helpful assistant.');
    for (const line of core.identity.lines) expect(prompt).not.toContain(line);
    // The rest of the core survives, which is what makes it hard to spot.
    expect(prompt).toContain(core.boundaries.lines[0]);
  });
});

describe('attributing an output to a version', () => {
  it('puts the version in the prompt, so an evaluation need not be told out of band', () => {
    const prompt = composedPrompt(voiceProfile());

    expect(prompt).toContain(fingerprintVersionMarker(core));
    expect(readFingerprintVersion(prompt)).toBe(core.collection.version);
  });

  it('reads a version back out of any prompt carrying the marker', () => {
    expect(
      readFingerprintVersion(`noise\n${FINGERPRINT_VERSION_MARKER_PREFIX} some_core v2.3.1\nnoise`)
    ).toBe('2.3.1');
  });

  it('returns null rather than a default when there is no marker', () => {
    expect(readFingerprintVersion('a prompt from some other agent entirely')).toBeNull();
  });

  it('drops the version marker when the identity it stamps is gone', () => {
    // A version stamp on an empty persona would claim a fingerprint the prompt
    // does not carry, and that is worse than no stamp: an evaluation would
    // attribute the output to a version of her voice that never reached it.
    const hollow = { ...core, identity: { ...core.identity, lines: [] } };

    expect(composeFingerprintProfileSections(hollow).persona).toBe('');
  });
});

describe('an empty block never reaches the prompt as a bare heading', () => {
  it('drops a block whose beats are gone rather than emitting its heading', () => {
    const hollow = {
      ...core,
      grounding: { ...core.grounding, lines: [] },
      boundaries: { ...core.boundaries, lines: [], howYouDecline: [] },
      cadence: { ...core.cadence, lines: [], reachesFor: [], avoids: [] },
    };
    const sections = composeFingerprintProfileSections(hollow);

    // Not merely "does not contain the beats" — a heading with nothing under it
    // reads to a model as a section that exists and has nothing to say, and it
    // would defeat the seed's emptiness guard by keeping every section truthy.
    expect(sections.guardrails).toBe('');
    expect(sections.brandVoiceInstructions).toBe('');
  });
});

describe('no knowledge retrieval is in this path', () => {
  /** The three modules that turn the authored core into a system prompt. */
  const ROOTS = [
    'lib/app/voice/fingerprint.ts',
    'lib/app/content/index.ts',
    'lib/orchestration/agents/resolve-effective-prompt.ts',
  ];

  function sourceOf(relativePath: string): string {
    return readFileSync(join(process.cwd(), relativePath), 'utf-8');
  }

  /** Every module specifier a file imports from, static and dynamic. */
  function importsOf(relativePath: string): string[] {
    return [...sourceOf(relativePath).matchAll(/from\s+'([^']+)'|import\(\s*'([^']+)'/g)].map(
      (match) => match[1] ?? match[2]
    );
  }

  /** `@/x/y` to the file on disk, trying the same extensions the bundler does. */
  function resolveAlias(specifier: string): string | null {
    if (!specifier.startsWith('@/')) return null;
    const base = specifier.slice(2);
    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base]) {
      if (existsSync(join(process.cwd(), candidate))) return candidate;
    }
    return null;
  }

  /**
   * Every `@/` module reachable from the roots, and every specifier seen on the
   * way — including the ones that resolve to nothing on disk (`@/content/*.json`,
   * bare packages), which still have to be inspected.
   */
  function closure(): { modules: Set<string>; specifiers: Set<string> } {
    const modules = new Set<string>();
    const specifiers = new Set<string>();
    const queue = [...ROOTS];

    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (modules.has(current)) continue;
      modules.add(current);

      for (const specifier of importsOf(current)) {
        specifiers.add(specifier);
        const resolved = resolveAlias(specifier);
        if (resolved && resolved.endsWith('.ts') && !modules.has(resolved)) queue.push(resolved);
      }
    }
    return { modules, specifiers };
  }

  it('walks past the roots — a one-hop check is what made this pass while false', () => {
    // fp6, and the reason this block was rewritten. The first version scanned
    // only each root's OWN import list, so it reported clean while the property
    // was already violated one hop away: `fingerprint.ts` imported the slug
    // prefix from `corpus-access.ts`, which imports `@/lib/db/client`, which
    // builds a `pg.Pool` at import time. A guard that cannot see the edge it
    // exists to catch is worse than no guard, because it reads as coverage.
    const { modules } = closure();

    expect(modules.size).toBeGreaterThan(ROOTS.length);
    expect(modules).toContain('lib/app/content/schemas.ts');
    expect(modules).toContain('lib/app/voice/designation.ts');
  });

  it('reaches neither the database nor the knowledge layer, anywhere in the closure', () => {
    const { modules, specifiers } = closure();

    for (const specifier of specifiers) {
      expect(specifier, `reached from one of: ${[...modules].join(', ')}`).not.toMatch(
        /knowledge|vector|embedding/i
      );
      expect(specifier).not.toMatch(/^@\/lib\/db(\/|$)/);
      expect(specifier).not.toMatch(/^(pg|@prisma\/client)$/);
    }
  });

  it('would fail if a database module were one hop away', () => {
    // The counterfactual, run rather than asserted: `corpus-access.ts` is the
    // module the prefix used to come from, and it is still one hop from the
    // database. If this ever stops holding, the case above has stopped meaning
    // anything and this one says so first.
    expect(importsOf('lib/app/voice/corpus-access.ts')).toContain('@/lib/db/client');
  });
});

describe('the agent this core is written for', () => {
  it('is one of hers, so t-25 designation rule governs what it can quote', () => {
    // Derived from the prefix rather than typed out, but asserted anyway: the
    // slug is what makes the corpus contributor fire for this agent at all.
    expect(VOICE_AGENT_SLUG.startsWith(CORPUS_AGENT_SLUG_PREFIX)).toBe(true);
  });

  it('keeps its own instructions about the work, not about her voice', () => {
    // A restatement here would be a second copy of the core with nothing keeping
    // it in step — and the agent's copy, being an override, would win.
    for (const beat of everyBeat()) {
      expect(VOICE_AGENT_SYSTEM_INSTRUCTIONS).not.toContain(beat);
    }
  });
});
