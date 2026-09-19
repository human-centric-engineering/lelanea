/**
 * Least privilege and observe-only guards, pinned (f-safety t-60).
 *
 * "A talked-into deletion attempt cannot delete anything" is only as true as
 * the tool set she holds. The allowlist is typed, so a grant outside it does not
 * compile. This file is the half the type cannot see: a slug that writes must
 * never be ADDED to the allowlist itself. It names every write capability the
 * install ships, in Sunrise and in Daybreak, and fails if one appears.
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
  READ_ONLY_CAPABILITY_SLUGS,
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

describe('her tools', () => {
  it('are exactly the read-only allowlist', () => {
    expect([...GRANTED_CAPABILITY_SLUGS]).toEqual([...READ_ONLY_CAPABILITY_SLUGS]);
  });

  it('never include anything that writes', () => {
    // The population is non-empty, so an empty intersection means something.
    expect(READ_ONLY_CAPABILITY_SLUGS.length).toBeGreaterThan(0);
    const allowed: readonly string[] = READ_ONLY_CAPABILITY_SLUGS;
    const granted: readonly string[] = GRANTED_CAPABILITY_SLUGS;
    for (const slug of WRITE_CAPABILITY_SLUGS) {
      expect(allowed, `${slug} writes — it cannot be on her allowlist`).not.toContain(slug);
      expect(granted, `${slug} writes — it cannot be granted to her`).not.toContain(slug);
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
