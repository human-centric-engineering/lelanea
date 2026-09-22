/**
 * Least privilege and observe-only guards, pinned (f-safety t-60).
 *
 * "A talked-into deletion attempt cannot delete anything" is only as true as
 * the tool set she holds. The allowlist is typed, so a grant outside it does not
 * compile. This file is the half the type cannot see: a slug that writes must
 * never be ADDED to the allowlist itself. It names every write capability the
 * install ships, in Sunrise and in Daybreak, and fails if one appears.
 *
 * **One exception is now argued for rather than assumed** (f-slots t-72). §11
 * needs her to record what she learns about a person, so the ceiling was
 * restated by the owner on 20 Sept 2026 from "she may only hold tools that
 * read" to "nothing she holds may delete anything, or act on anyone else's
 * behalf". `fill_slot` is admitted under it and is listed in
 * {@link SANCTIONED_SELF_WRITES} below — still named as a write, still failing
 * every case but the one that names it. The sentence that mattered is unmoved:
 * nothing she holds deletes.
 *
 * The guard modes and the escalation payloads are pinned for the same reason.
 * `block` would turn a heuristic false positive into her `unavailable` ending,
 * and a payload the framework's schema refuses would never fire.
 *
 * Her ADVERTISED set on a real install (what an operator bound) is checked by
 * `npm run smoke:app-misuse`. So is the chat path refusing a model-emitted name
 * outside it; the mechanism itself is Sunrise's `tool_not_advertised`, pinned
 * in `tests/unit/lib/orchestration/chat/streaming-handler.test.ts`.
 */

import { describe, it, expect } from 'vitest';

import {
  ESCALATION_POLICIES,
  GRANTED_CAPABILITY_SLUGS,
  GUARD_MODES,
  HER_CAPABILITY_SLUGS,
  READ_ONLY_CAPABILITY_SLUGS,
  RESOURCE_CAPABILITY_SLUGS,
  SELF_WRITE_CAPABILITY_SLUGS,
  SLOT_CAPABILITY_SLUGS,
  SEATED_ROLES,
} from '@/lib/app/agent/pins';
import { assertValidFacilitationPolicy } from '@/lib/framework/facilitation/policies/kinds';

/**
 * Capabilities the install ships that write, delete, send, spend or change
 * configuration. Read off each class's `execute()`, 19 Sept 2026.
 */
const WRITE_CAPABILITY_SLUGS = [
  // Sunrise built-ins
  'write_user_memory',
  'upload_to_storage',
  'send_message_to_channel',
  'call_external_api',
  'run_workflow',
  'escalate_to_human',
  'apply_audit_changes',
  'add_provider_models',
  'deactivate_provider_models',
  'rewrite_with_llm',
  'rewrite_section_with_llm',
  'strip_lines_matching',
  'strip_matches',
  'strip_timestamps',
  'strip_speaker_labels',
  'collapse_whitespace',
  'dedupe_lines',
  'normalise_punctuation',
  'join_wrapped_lines',
  // Daybreak
  'fill_slot',
  'request_transition',
  'record_feedback',
  'submit_proposal',
];

/**
 * The one write she is allowed, and the whole reason it is allowed.
 *
 * Owner ruling, 20 Sept 2026 (f-slots t-72): the ceiling became "nothing she
 * holds may delete anything, or act on anyone else's behalf". `fill_slot`
 * qualifies — own profile only, appends rather than overwrites, sends and
 * spends nothing on anyone's account. The argument is in
 * `SELF_WRITE_CAPABILITY_SLUGS`' docblock; this constant is what stops the
 * exception becoming a habit.
 *
 * **Adding a second slug here is a security review, not an edit**, and if this
 * list ever grows past a couple of entries the exception has become the rule
 * and the ceiling needs restating again rather than widening again.
 */
const SANCTIONED_SELF_WRITES = ['fill_slot'];

describe('her tools', () => {
  it('are exactly what the three seeds grant, and nothing else', () => {
    expect(
      [...GRANTED_CAPABILITY_SLUGS, ...SLOT_CAPABILITY_SLUGS, ...RESOURCE_CAPABILITY_SLUGS].sort()
    ).toEqual([...HER_CAPABILITY_SLUGS].sort());
  });

  it('never include anything that writes, bar the one sanctioned self-write', () => {
    // The population is non-empty, so an empty intersection means something.
    expect(HER_CAPABILITY_SLUGS.length).toBeGreaterThan(0);
    expect(WRITE_CAPABILITY_SLUGS.length).toBeGreaterThan(0);
    const allowed: readonly string[] = HER_CAPABILITY_SLUGS;
    const granted: readonly string[] = [
      ...GRANTED_CAPABILITY_SLUGS,
      ...SLOT_CAPABILITY_SLUGS,
      ...RESOURCE_CAPABILITY_SLUGS,
    ];
    for (const slug of WRITE_CAPABILITY_SLUGS) {
      if (SANCTIONED_SELF_WRITES.includes(slug)) continue;
      expect(allowed, `${slug} writes — it cannot be on her allowlist`).not.toContain(slug);
      expect(granted, `${slug} writes — it cannot be granted to her`).not.toContain(slug);
    }
  });

  it('keep the sanctioned exception to exactly what was argued for', () => {
    // Both directions. A slug added to `SELF_WRITE_CAPABILITY_SLUGS` without
    // being argued for here fails; so does one quietly dropped from the write
    // list above to get it past the case before this one.
    expect([...SELF_WRITE_CAPABILITY_SLUGS]).toEqual(SANCTIONED_SELF_WRITES);
    for (const slug of SANCTIONED_SELF_WRITES) {
      expect(
        WRITE_CAPABILITY_SLUGS,
        `${slug} is exempted as a write — it must still be listed as one`
      ).toContain(slug);
    }
  });

  it('keep every read-only slug genuinely read-only', () => {
    const readOnly: readonly string[] = READ_ONLY_CAPABILITY_SLUGS;
    for (const slug of WRITE_CAPABILITY_SLUGS) {
      expect(readOnly, `${slug} writes — it is not read-only`).not.toContain(slug);
    }
  });
});

describe('her guards', () => {
  it('observe and never block, so a heuristic hit never reads as an outage', () => {
    expect(GUARD_MODES).toEqual({ inputGuardMode: 'log_only', outputGuardMode: 'log_only' });
  });
});

describe('her escalation policies', () => {
  it('cover each of her seats once, on the input guard, from the first detection', () => {
    expect(ESCALATION_POLICIES.map((policy) => policy.scope.id)).toEqual([...SEATED_ROLES]);
    for (const policy of ESCALATION_POLICIES) {
      expect(policy.signal).toEqual({ guard: 'input', outcome: 'flagged' });
    }
  });

  it("pass the framework's own schema, so the admin surface would accept them", () => {
    for (const policy of ESCALATION_POLICIES) {
      expect(assertValidFacilitationPolicy('escalation', policy)).toEqual({
        kind: 'escalation',
        payload: policy,
      });
    }
  });
});
