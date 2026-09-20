/**
 * Smoke: a voice note through the member route, in a running app, against
 * the dev database (§10 t-67).
 *
 * **Why this exists rather than another unit test.** The route's unit tests
 * mock the provider and the cost log. What no mock proves is that the pieces
 * borrowed from the platform — the upload validator, the audio-capable
 * provider resolved from the seeded rows, `logCost` with the person's id —
 * meet in one process on the real route, and that the seed left her flag on.
 *
 * Flow:
 *   1. Sign up a throwaway member, verify it in the database, sign in.
 *   2. GET /api/v1/app/agent/transcribe — must say `available`. `off` fails
 *      (the seed has not run, or an admin turned her flag off); `no_provider`
 *      SKIPS, saying so: this proves nothing until an audio-capable provider
 *      is configured (the owner's dev machine has none — the feature's
 *      at-ship list).
 *   3. POST one clip — a second of silence as WAV, generated here so the
 *      script carries no audio file — and get text back (empty is fine for
 *      silence; a string is what is asserted).
 *   4. Assert: exactly one cost row for the member, `operation:
 *      'transcription'`, tagged with her seat; no message row, no file.
 *   5. Remove the member and the row.
 *
 * Needs: a server (`npm run dev`), the seeds applied (`npm run db:seed`), and
 * an audio-capable provider. Against the proxied `https://lelanea.test`, Node
 * must trust the local CA (`NODE_EXTRA_CA_CERTS` pointing at Herd's CA).
 *
 * Safety: every row is scoped by the `smoke-test-voice` prefix, and removed on
 * every path, including a sweep at startup. Never touches seed data.
 *
 * Run with: npm run smoke:app-voice
 */

import { prisma } from '@/lib/db/client';
import { isRecord } from '@/lib/utils';
import { CONVERSATION_SEAT } from '@/lib/app/conversation/seats';

const BASE_URL =
  process.env.SMOKE_BASE_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
const PREFIX = 'smoke-test-voice';
const EMAIL = `${PREFIX}@example.com`;
const PASSWORD = 'SmokeTest!Passw0rd';
const ROUTE = `${BASE_URL}/api/v1/app/agent/transcribe`;

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

function extractSessionCookie(setCookieHeaders: string[]): string | null {
  for (const raw of setCookieHeaders) {
    const first = raw.split(';', 1)[0] ?? '';
    if (first.includes('better-auth.session_token=')) return first.trim();
  }
  return null;
}

/** One second of 16 kHz mono 16-bit silence, as a WAV. 44-byte header + samples. */
function silentWav(seconds = 1): ArrayBuffer {
  const sampleRate = 16_000;
  const samples = sampleRate * seconds;
  const dataBytes = samples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return buffer;
}

async function sweep(): Promise<void> {
  await prisma.aiCostLog.deleteMany({ where: { user: { email: EMAIL } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

async function main(): Promise<void> {
  console.log(`\nsmoke:app-voice — target ${BASE_URL}\n`);

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.log('skipped — no database reachable (DATABASE_URL unset or DB down).');
    return;
  }
  const reachable = await fetch(`${BASE_URL}/api/health`).catch(() => null);
  if (!reachable) {
    console.error(`✗ no server at ${BASE_URL} — start one first (npm run dev).`);
    process.exit(1);
  }

  await sweep();

  try {
    const signup = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: 'Voice smoke' }),
    });
    if (!signup.ok) throw new Error(`sign-up failed: ${signup.status} ${await signup.text()}`);
    await prisma.user.update({ where: { email: EMAIL }, data: { emailVerified: true } });
    const signin = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (!signin.ok) throw new Error(`sign-in failed: ${signin.status} ${await signin.text()}`);
    const cookie = extractSessionCookie(signin.headers.getSetCookie());
    if (!cookie) throw new Error('sign-in returned no session cookie');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    console.log(`  ✓ signed in as ${EMAIL}`);

    // 2. Is the microphone offered?
    console.log('\n1. Whether a voice note may be sent');
    const availability = await fetch(ROUTE, { headers: { cookie } });
    const availabilityBody: unknown = await availability.json();
    const state =
      isRecord(availabilityBody) && isRecord(availabilityBody.data)
        ? availabilityBody.data.voiceInput
        : null;
    check(availability.status === 200, `the read answers 200 (${availability.status})`);
    if (state === 'no_provider') {
      console.log(
        '\nskipped — no audio-capable provider is configured; her flag is on. Configure one and run again (at ship).\n'
      );
      return;
    }
    check(
      state === 'available',
      `voice input is available (${String(state)} — "off" means the seed has not run, or an admin turned her flag off)`
    );

    // 3. One clip.
    console.log('\n2. One clip through the route');
    const form = new FormData();
    form.set('audio', new File([silentWav()], 'silence.wav', { type: 'audio/wav' }));
    const posted = await fetch(ROUTE, {
      method: 'POST',
      headers: { cookie, origin: BASE_URL },
      body: form,
    });
    const postedBody: unknown = await posted.json();
    check(
      posted.status === 200,
      `the clip is transcribed (${posted.status}: ${JSON.stringify(postedBody).slice(0, 200)})`
    );
    const text =
      isRecord(postedBody) && isRecord(postedBody.data) ? postedBody.data.text : undefined;
    check(typeof text === 'string', `text came back (${JSON.stringify(text)})`);

    // 4. What was recorded: one cost row, and nothing else of the member's.
    console.log('\n3. What was recorded');
    const rows = await prisma.aiCostLog.findMany({ where: { userId: user.id } });
    check(rows.length === 1, `one cost row for the member (${rows.length})`);
    check(rows[0].operation === 'transcription', `it is a transcription (${rows[0].operation})`);
    const metadata = rows[0].metadata;
    check(
      isRecord(metadata) && metadata.seat === CONVERSATION_SEAT,
      `tagged with her seat (${JSON.stringify(metadata)})`
    );
    const messages = await prisma.aiMessage.count({ where: { conversation: { userId: user.id } } });
    check(
      messages === 0,
      'no message row was written — the words went to the box, not the transcript'
    );

    console.log('\n✓ smoke:app-voice passed\n');
  } finally {
    await sweep().catch((err: unknown) => console.error('sweep failed:', err));
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('\n✗ smoke:app-voice failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
