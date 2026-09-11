/**
 * initFramework() unit test — asserts its exact contract: it registers the
 * framework's one context contributor (the "module" type → `loadModuleContext`)
 * into core's seam. Mocks the core module so the assertion is on the
 * registration call itself, not on `buildContext`'s framing (which is core-owned
 * and would make the test brittle / tautological). The real end-to-end chain is
 * covered by tests/integration/lib/framework/boot.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

vi.mock('@/lib/orchestration/chat/context-builder', () => ({
  registerContextContributor: vi.fn(),
}));
vi.mock('@/lib/orchestration/knowledge/resolveAgentDocumentAccess', () => ({
  registerAgentAccessContributor: vi.fn(),
}));

const { registerContextContributor } = await import('@/lib/orchestration/chat/context-builder');
const { registerAgentAccessContributor } =
  await import('@/lib/orchestration/knowledge/resolveAgentDocumentAccess');
const { initFramework } = await import('@/lib/framework');
const { loadModuleContext, MODULE_CONTEXT_TYPE, MODULE_CONTEXT_UNAVAILABLE } =
  await import('@/lib/framework/modules/context');
const { resolveModuleKnowledgeForAgent, MODULE_KNOWLEDGE_CONTRIBUTOR_KEY } =
  await import('@/lib/framework/modules/knowledge/contributor');

const registerMock = registerContextContributor as ReturnType<typeof vi.fn>;
const registerAccessMock = registerAgentAccessContributor as ReturnType<typeof vi.fn>;

beforeEach(() => {
  registerMock.mockClear();
  registerAccessMock.mockClear();
});

describe('initFramework', () => {
  it('registers exactly the module context contributor', () => {
    initFramework();
    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledWith(MODULE_CONTEXT_TYPE, loadModuleContext);
  });

  it('registers exactly one context contributor per boot', () => {
    initFramework();
    expect(registerMock).toHaveBeenCalledTimes(1);
  });

  it('registers the module knowledge access contributor under its key', () => {
    initFramework();
    expect(registerAccessMock).toHaveBeenCalledTimes(1);
    expect(registerAccessMock).toHaveBeenCalledWith(
      MODULE_KNOWLEDGE_CONTRIBUTOR_KEY,
      resolveModuleKnowledgeForAgent
    );
  });
});

describe('the framework tier registers no MODULES of its own', () => {
  it('leaves the module registry empty, which is what makes registerLeaf load-bearing', async () => {
    // A WITNESS for prose, not a behavioural requirement (#245). `lib/framework/seed.ts`
    // and `building-on-daybreak.md` both tell a leaf that omitting `registerLeaf`
    // produces a SILENT failure — a missing `Module` row and no error — rather than
    // rows flagged as removed. That is only true while this list is empty:
    // `syncRegisteredModules()` no-ops on an EMPTY registry but does run its retire
    // pass on a PARTIAL one.
    //
    // So the day Daybreak registers a framework module here, both documents flip from
    // right to wrong with nothing else failing. This test is what fails instead. If it
    // does, do not delete it — update the prose it guards, then update this test's
    // expectation to match.
    const { getRegisteredModules, registerModule, __resetModuleRegistryForTests } =
      await import('@/lib/framework/modules/registry');

    // POSITIVE CONTROL FIRST. Without it this whole test is unfalsifiable in the
    // one direction that matters: `expect(...).toEqual([])` passes just as happily
    // when `getRegisteredModules()` is BROKEN and always returns `[]` as when the
    // registry is genuinely empty — verified by stubbing it to `return []`, which
    // left this green. A witness that cannot report a positive is not a witness.
    //
    // So: prove the read can see a module, then clear it and ask the real question.
    __resetModuleRegistryForTests();
    registerModule({
      slug: 'probe-control',
      name: 'Probe',
      description: 'positive control for this test only',
      configSchema: z.object({}),
    });
    expect(
      getRegisteredModules().map((m) => m.slug),
      'getRegisteredModules() cannot see a registered module — the assertion below is vacuous'
    ).toEqual(['probe-control']);
    __resetModuleRegistryForTests();

    initFramework();

    expect(getRegisteredModules()).toEqual([]);
    // No cleanup needed after this point: the assertion above IS that the registry
    // is empty, and the probe was cleared before `initFramework()` ran.
  });
});

describe('loadModuleContext (unregistered slug)', () => {
  it('resolves to the "not available yet" body when the slug is not a registered module', async () => {
    // No modules are registered in this init-only test, so any slug is unknown.
    await expect(loadModuleContext('any-slug')).resolves.toBe(MODULE_CONTEXT_UNAVAILABLE);
  });
});
