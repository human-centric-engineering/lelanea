/**
 * A voice note, transcribed and discarded (§10 t-67; product description §3.3;
 * owner ruling 19 Sept 2026: transcribe and discard, text only, said at the
 * microphone).
 *
 * Speech-to-text exists in the platform for the embed widget and the admin
 * chat, and nowhere for a signed-in member. This is the member's: the same
 * pieces those two routes use — the upload validator, the audio sub-cap, the
 * audio-capable provider, the cost log — behind `withAuth`, keyed on the
 * person, costed to the person, tagged with her seat.
 *
 * ## Two switches, both honoured
 *
 * `AiOrchestrationSettings.voiceInputGloballyEnabled` is an operator's off
 * switch that needs no deploy; her agent's `enableVoiceInput` is the flag the
 * seed turns on once (`prisma/seeds/app-lelanea/012-agent-voice-input.ts`) and
 * an admin may turn off. Either off → the route refuses and the microphone is
 * not offered — the pane asks {@link voiceInputAvailability} first.
 *
 * ## What happens to the audio: nothing
 *
 * The clip goes to the provider and nowhere else. No file write, no row with
 * its bytes, no log line with its bytes or its text — the route logs the
 * person's id, the provider, the model, the duration and the byte count. The
 * text goes back to the person's box to read, edit and send, or not.
 *
 * @see .context/app/conversation.md — "The microphone"
 */

import { prisma } from '@/lib/db/client';
import { getAudioProvider } from '@/lib/orchestration/llm/provider-manager';
import { CONVERSATION_SEAT } from '@/lib/app/conversation/seats';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';

/**
 * Whether a member may speak instead of type, and why not.
 *
 * - `available` — both switches on, an audio-capable provider configured.
 * - `off` — an operator's switch is off (global or hers); the control is not offered.
 * - `no_provider` — allowed, but nothing to transcribe with; the control is not offered either.
 */
export type VoiceInputState = 'available' | 'off' | 'no_provider';

export interface VoiceInputAvailability {
  state: VoiceInputState;
  /** Her agent's id, for the cost row. Null when she does not exist. */
  agentId: string | null;
}

/** The two switches alone — what the transcribe route asks before touching the provider. */
export async function voiceInputSwitches(): Promise<{ on: boolean; agentId: string | null }> {
  const [settings, agent] = await Promise.all([
    prisma.aiOrchestrationSettings.findUnique({
      where: { slug: 'global' },
      select: { voiceInputGloballyEnabled: true },
    }),
    prisma.aiAgent.findFirst({
      where: { slug: VOICE_AGENT_SLUG, deletedAt: null, isActive: true },
      select: { id: true, enableVoiceInput: true },
    }),
  ]);
  // No settings row is the platform's default: on. A row that says off is off.
  const globallyOn = !settings || settings.voiceInputGloballyEnabled;
  const on = globallyOn && agent !== null && agent.enableVoiceInput;
  return { on, agentId: agent?.id ?? null };
}

export async function voiceInputAvailability(): Promise<VoiceInputAvailability> {
  const switches = await voiceInputSwitches();
  if (!switches.on || switches.agentId === null) return { state: 'off', agentId: switches.agentId };
  const audio = await getAudioProvider();
  return { state: audio ? 'available' : 'no_provider', agentId: switches.agentId };
}

/** What a transcription's cost row carries beside the platform's own fields. */
export function transcriptionCostMetadata(language: string | undefined): Record<string, unknown> {
  return { seat: CONVERSATION_SEAT, ...(language ? { language } : {}) };
}
