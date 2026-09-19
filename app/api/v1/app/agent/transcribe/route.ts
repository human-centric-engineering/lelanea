/**
 * Conversation — a voice note, transcribed
 *
 * POST /api/v1/app/agent/transcribe — multipart, `audio` (a clip) and an
 * optional `language` hint → `{ text, durationMs, language? }`. What the
 * composer's microphone posts (§10 t-67). The clip goes to the audio-capable
 * provider and nowhere else: no file, no row, no log line carries its bytes or
 * its text. See `lib/app/agent/voice-input.ts`.
 *
 * GET /api/v1/app/agent/transcribe — `{ voiceInput: 'available' | 'off' |
 * 'no_provider' }`, what the pane asks before offering the microphone.
 *
 * Authentication: required — only members talk to her.
 *
 * Rate limiting: the `/api/v1/**` section cap, and the platform's audio
 * sub-cap keyed on the person (`audio:app:<userId>`) — the one expensive
 * sub-flow here, and the one case CLAUDE.md asks a handler to cap itself.
 *
 * Caching: `no-store` on the read; a switch may flip between two asks.
 */

import { withAuth, type WithAuthOptions } from '@/lib/auth/guards';
import { errorResponse, successResponse } from '@/lib/api/responses';
import { getRouteLogger } from '@/lib/api/context';
import { audioLimiter, createRateLimitResponse } from '@/lib/security/rate-limit';
import { getAudioProvider } from '@/lib/orchestration/llm/provider-manager';
import { logCost } from '@/lib/orchestration/llm/cost-tracker';
import { ProviderError } from '@/lib/orchestration/llm/provider';
import { enforceContentLengthCap, validateTranscribeUpload } from '@/lib/validations/transcribe';
import {
  transcriptionCostMetadata,
  voiceInputAvailability,
  voiceInputSwitches,
} from '@/lib/app/agent/voice-input';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Ownership: self — the clip is the caller's, and the cost row is theirs. */
const OWNERSHIP: WithAuthOptions = {
  ownership: {
    decidedBy: 'self',
    because:
      "A voice note is the caller's own, transcribed for the caller's own box and costed to the caller's id. Nothing is read or written that belongs to anyone else.",
  },
};

export const GET = withAuth(async () => {
  const { state } = await voiceInputAvailability();
  return successResponse({ voiceInput: state }, undefined, {
    headers: { 'Cache-Control': 'no-store' },
  });
}, OWNERSHIP);

// Audit invariant: this handler MUST NOT persist audio bytes. The only write
// on the happy path is `logCost(...)`, and the route's tests assert it.
export const POST = withAuth(async (request, session) => {
  const log = await getRouteLogger(request);
  const userId = session.user.id;

  const rateLimit = audioLimiter.check(`audio:app:${userId}`);
  if (!rateLimit.success) return createRateLimitResponse(rateLimit);

  // The size cap, before the body is read at all.
  const oversize = enforceContentLengthCap(request);
  if (oversize) return oversize;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse('Expected multipart/form-data body', {
      code: 'INVALID_BODY',
      status: 400,
    });
  }

  // The two switches, and her agent, before the provider is even asked.
  const switches = await voiceInputSwitches();
  if (!switches.on || switches.agentId === null) {
    return errorResponse('Voice input is off', { code: 'VOICE_DISABLED', status: 403 });
  }
  const agentId = switches.agentId;

  // The validator wants an `agentId` field; it is hers, never the caller's.
  formData.set('agentId', agentId);
  const validation = validateTranscribeUpload(formData);
  if (!validation.ok) return validation.response;
  const { file, language } = validation.value;

  const audio = await getAudioProvider();
  if (!audio) {
    return errorResponse('No audio-capable provider is configured', {
      code: 'NO_AUDIO_PROVIDER',
      status: 503,
    });
  }

  try {
    const result = await audio.provider.transcribe(file, {
      model: audio.modelId,
      ...(language ? { language } : {}),
      mimeType: file.type,
      filename: file.name || 'audio.webm',
    });

    // Awaited, so the meter has the row before the person has the words.
    await logCost({
      agentId,
      userId,
      model: audio.modelId,
      provider: audio.providerSlug,
      inputTokens: 0,
      outputTokens: 0,
      operation: 'transcription',
      durationMs: result.durationMs,
      metadata: transcriptionCostMetadata(result.language),
    });

    log.info('Voice note transcribed', {
      userId,
      provider: audio.providerSlug,
      model: audio.modelId,
      durationMs: result.durationMs,
      bytes: file.size,
    });

    return successResponse({
      text: result.text,
      durationMs: result.durationMs,
      ...(result.language ? { language: result.language } : {}),
    });
  } catch (err) {
    log.error('Voice note transcription failed', {
      userId,
      provider: audio.providerSlug,
      model: audio.modelId,
      error: err instanceof Error ? err.message : String(err),
      code: err instanceof ProviderError ? err.code : undefined,
    });
    return errorResponse('Transcription failed', { code: 'TRANSCRIPTION_FAILED', status: 502 });
  }
}, OWNERSHIP);
