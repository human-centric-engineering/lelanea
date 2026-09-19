/**
 * A voice note through the member route: text back, one cost row with the
 * person's id and no other write; each switch refuses with zero provider
 * calls; oversize refused before the provider; nobody signed out (§10 t-67).
 *
 * The provider, the limiter and the cost log are mocked; the two switches are
 * rows on a fake Prisma. Each "refuses" case first shows the same request
 * reaches the provider with the switches on (`fp6`).
 *
 * @see app/api/v1/app/agent/transcribe/route.ts
 * @see lib/app/agent/voice-input.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { mockAuthenticatedUser, mockUnauthenticatedUser } from '@/tests/helpers/auth';
import { assertNoAudioPersistence } from '@/tests/helpers/no-audio-persistence';

const routeLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: () => Promise.resolve(routeLog) }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db/client', () => ({
  prisma: {
    aiOrchestrationSettings: { findUnique: vi.fn() },
    aiAgent: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/security/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/rate-limit')>();
  return { ...actual, audioLimiter: { check: vi.fn(() => ({ success: true })) } };
});
vi.mock('@/lib/orchestration/llm/provider-manager', () => ({ getAudioProvider: vi.fn() }));
vi.mock('@/lib/orchestration/llm/cost-tracker', () => ({ logCost: vi.fn(async () => null) }));

import { auth } from '@/lib/auth/config';
import { prisma } from '@/lib/db/client';
import { audioLimiter } from '@/lib/security/rate-limit';
import { getAudioProvider } from '@/lib/orchestration/llm/provider-manager';
import { logCost } from '@/lib/orchestration/llm/cost-tracker';
import { GET, POST } from '@/app/api/v1/app/agent/transcribe/route';

const HER = { id: 'agent-hers', enableVoiceInput: true };

function clip(bytes = new Uint8Array([1, 2, 3, 4])): File {
  return new File([bytes], 'voice.webm', { type: 'audio/webm' });
}

function post(formData: FormData, headers: Record<string, string> = {}): NextRequest {
  return {
    method: 'POST',
    headers: new Headers(headers),
    url: 'https://lelanea.com/api/v1/app/agent/transcribe',
    nextUrl: new URL('https://lelanea.com/api/v1/app/agent/transcribe'),
    formData: () => Promise.resolve(formData),
  } as unknown as NextRequest;
}

function form(file: File | null = clip(), language?: string): FormData {
  const fd = new FormData();
  if (file) fd.set('audio', file);
  if (language) fd.set('language', language);
  // A caller's agentId is ignored: hers is set server-side.
  fd.set('agentId', 'somebody-elses-agent');
  return fd;
}

const transcribe = vi.fn();
const audio = () => ({ provider: { transcribe }, modelId: 'whisper-1', providerSlug: 'openai' });

async function json<T>(response: Response): Promise<T> {
  return JSON.parse(await response.text()) as T;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
  vi.mocked(audioLimiter.check).mockReturnValue({ success: true } as never);
  vi.mocked(prisma.aiOrchestrationSettings.findUnique).mockResolvedValue({
    voiceInputGloballyEnabled: true,
  } as never);
  vi.mocked(prisma.aiAgent.findFirst).mockResolvedValue(HER as never);
  vi.mocked(getAudioProvider).mockResolvedValue(audio() as never);
  transcribe.mockResolvedValue({ text: 'what I said', durationMs: 1200, language: 'en' });
});

describe('POST — a clip, transcribed', () => {
  it('returns the text, and writes one cost row with the person’s id and her seat — nothing else', async () => {
    const response = await POST(post(form(clip(), 'en')));
    expect(response.status).toBe(200);
    const body = await json<{ data: { text: string; durationMs: number; language: string } }>(
      response
    );
    expect(body.data).toEqual({ text: 'what I said', durationMs: 1200, language: 'en' });

    // The clip went to the provider, as a file, with the hint.
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0][1]).toMatchObject({ model: 'whisper-1', language: 'en' });

    // One cost row: the person's, on her seat, and no other write on the client.
    const me = mockAuthenticatedUser('USER').user.id;
    expect(logCost).toHaveBeenCalledTimes(1);
    expect(logCost).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: me,
        agentId: HER.id,
        operation: 'transcription',
        durationMs: 1200,
        model: 'whisper-1',
        provider: 'openai',
        metadata: { seat: 'facilitator', language: 'en' },
      })
    );
    assertNoAudioPersistence(vi.mocked(logCost), 'logCost');
    const writes = Object.entries(prisma).flatMap(([model, delegate]) =>
      Object.keys(delegate as Record<string, unknown>)
        .filter((m) => /create|update|upsert|delete/.test(m))
        .map((m) => `${model}.${m}`)
    );
    expect(writes).toEqual([]);
  });

  it('never logs the words or the bytes', async () => {
    await POST(post(form()));
    const logged = JSON.stringify(routeLog.info.mock.calls);
    expect(logged).not.toContain('what I said');
    expect(logged).not.toContain('1,2,3,4');
    expect(logged).toContain('"bytes":4');
  });

  it('ignores the caller’s agentId — the cost row is hers', async () => {
    await POST(post(form()));
    expect(logCost).toHaveBeenCalledWith(expect.objectContaining({ agentId: HER.id }));
    expect(JSON.stringify(vi.mocked(logCost).mock.calls)).not.toContain('somebody-elses-agent');
  });

  it('refuses when the org-wide switch is off, with zero provider calls', async () => {
    // The population: with it on, the same request reaches the provider.
    await POST(post(form()));
    expect(transcribe).toHaveBeenCalledTimes(1);
    transcribe.mockClear();
    vi.mocked(getAudioProvider).mockClear();
    vi.mocked(logCost).mockClear();

    vi.mocked(prisma.aiOrchestrationSettings.findUnique).mockResolvedValue({
      voiceInputGloballyEnabled: false,
    } as never);
    const response = await POST(post(form()));
    expect(response.status).toBe(403);
    expect((await json<{ error: { code: string } }>(response)).error.code).toBe('VOICE_DISABLED');
    expect(transcribe).not.toHaveBeenCalled();
    expect(getAudioProvider).not.toHaveBeenCalled();
    expect(logCost).not.toHaveBeenCalled();
  });

  it('refuses when her flag is off, with zero provider calls', async () => {
    await POST(post(form()));
    expect(transcribe).toHaveBeenCalledTimes(1);
    transcribe.mockClear();
    vi.mocked(getAudioProvider).mockClear();
    vi.mocked(logCost).mockClear();

    vi.mocked(prisma.aiAgent.findFirst).mockResolvedValue({
      ...HER,
      enableVoiceInput: false,
    } as never);
    const response = await POST(post(form()));
    expect(response.status).toBe(403);
    expect(transcribe).not.toHaveBeenCalled();
    expect(getAudioProvider).not.toHaveBeenCalled();
    expect(logCost).not.toHaveBeenCalled();
  });

  it('refuses an oversize clip before the provider, from the declared length', async () => {
    const response = await POST(post(form(), { 'content-length': String(30 * 1024 * 1024) }));
    expect(response.status).toBe(413);
    expect(transcribe).not.toHaveBeenCalled();
    expect(getAudioProvider).not.toHaveBeenCalled();
  });

  it('refuses a clip that is not audio', async () => {
    const response = await POST(
      post(form(new File([new Uint8Array([1])], 'x.txt', { type: 'text/plain' })))
    );
    expect(response.status).toBe(415);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('says so when there is nothing to transcribe with', async () => {
    vi.mocked(getAudioProvider).mockResolvedValue(null);
    const response = await POST(post(form()));
    expect(response.status).toBe(503);
    expect(logCost).not.toHaveBeenCalled();
  });

  it('does not leak the provider’s error text', async () => {
    transcribe.mockRejectedValue(new Error('OPENAI_API_KEY invalid for host api.openai.com'));
    const response = await POST(post(form()));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('OPENAI_API_KEY');
    expect(logCost).not.toHaveBeenCalled();
  });

  it('is capped per person, before the body is read', async () => {
    vi.mocked(audioLimiter.check).mockReturnValue({
      success: false,
      limit: 10,
      remaining: 0,
      reset: Date.now() + 60_000,
    });
    const formData = form();
    const request = post(formData);
    const response = await POST(request);
    expect(response.status).toBe(429);
    const me = mockAuthenticatedUser('USER').user.id;
    expect(audioLimiter.check).toHaveBeenCalledWith(`audio:app:${me}`);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('refuses anyone signed out', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());
    const response = await POST(post(form()));
    expect(response.status).toBe(401);
    expect(transcribe).not.toHaveBeenCalled();
  });
});

describe('GET — whether the microphone is offered', () => {
  const get = () => GET(new NextRequest('https://lelanea.com/api/v1/app/agent/transcribe'));

  it('says available with both switches on and a provider', async () => {
    const response = await get();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await json<{ data: { voiceInput: string } }>(response)).data.voiceInput).toBe(
      'available'
    );
  });

  it('says off for either switch, and no_provider when allowed but nothing to transcribe with', async () => {
    vi.mocked(prisma.aiOrchestrationSettings.findUnique).mockResolvedValue({
      voiceInputGloballyEnabled: false,
    } as never);
    expect((await json<{ data: { voiceInput: string } }>(await get())).data.voiceInput).toBe('off');

    vi.mocked(prisma.aiOrchestrationSettings.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.aiAgent.findFirst).mockResolvedValue({
      ...HER,
      enableVoiceInput: false,
    } as never);
    expect((await json<{ data: { voiceInput: string } }>(await get())).data.voiceInput).toBe('off');

    vi.mocked(prisma.aiAgent.findFirst).mockResolvedValue(HER as never);
    vi.mocked(getAudioProvider).mockResolvedValue(null);
    expect((await json<{ data: { voiceInput: string } }>(await get())).data.voiceInput).toBe(
      'no_provider'
    );
  });

  it('refuses anyone signed out', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());
    expect((await get()).status).toBe(401);
  });
});
