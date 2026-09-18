/**
 * Smoke: a turn with her, sent twice, is one turn — through the real route, in
 * a running app, against the dev database (§08 t-54).
 *
 * **Why this exists rather than another unit test.** The load-bearing claim of
 * t-54 is that Daybreak's facilitation route REACHES the leaf's turn hook. The
 * hook is registered at boot (`instrumentation.ts` → `initApp()` →
 * `initLeafApp()`) into a `globalThis` registry the route reads, and whether
 * those two meet in one process is a fact about how Next bundles and boots the
 * app. No mock can prove it; a running server can.
 *
 * It also proves the price: her pinned model's cost row is greater than zero on
 * the real turn path (t-52's registration reaching a real turn), and the turn
 * record says `priced`.
 *
 * Flow:
 *   1. Sign up a throwaway member, verify it in the database, sign in.
 *   2. POST a turn to /api/v1/framework/facilitation/onboarding/chat/stream with
 *      a turn id; read the event stream to the end.
 *   3. POST the same turn id again.
 *   4. Assert: one model call's worth of cost, tagged with turn id + seat and
 *      greater than zero; one turn record, completed, priced, with a version;
 *      one user message carrying the tag; the second reply identical to the
 *      first.
 *   5. POST the same id with different words → 409.
 *   6. Remove the member and the cost rows this run wrote.
 *
 * Needs: a server (`npm run dev`), the seeds applied (`npm run db:seed` — she
 * must be public and seated), and a working OpenAI key under the `openai`
 * provider slug. It costs one real model call — about $0.0006.
 *
 * Safety: every row is scoped by the `smoke-test-turn` prefix or by this run's
 * turn id, and removed on every path, including a sweep at startup for anything
 * an interrupted run stranded. Never touches seed data, never deletes unscoped.
 *
 * Run with: npm run smoke:app-turn
 */

import { prisma } from '@/lib/db/client';
import { PINNED_MODEL } from '@/lib/app/agent/pinned-model';

// The app's own URL by default: better-auth refuses a sign-up from any origin
// it does not trust, and this install's is `BETTER_AUTH_URL`.
const BASE_URL =
  process.env.SMOKE_BASE_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
const PREFIX = 'smoke-test-turn';
const EMAIL = `${PREFIX}@example.com`;
const PASSWORD = 'SmokeTest!Passw0rd';
const SEAT = 'onboarding';
const TURN_ID = `${PREFIX}-${Date.now()}`;
const MESSAGE = 'Hello. I have just arrived — what is this place for?';

interface Frame {
  type: string;
  [key: string]: unknown;
}

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

/** Every `data:` frame of an SSE body, parsed. */
function parseFrames(body: string): Frame[] {
  return body
    .split('\n\n')
    .map((block) =>
      block
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice('data: '.length))
        .join('\n')
    )
    .filter((data) => data.length > 0)
    .map((data) => JSON.parse(data) as Frame);
}

function replyOf(frames: Frame[]): string {
  return frames
    .filter((frame) => frame.type === 'content')
    .map((frame) => String(frame.delta))
    .join('');
}

async function takeTurn(
  cookie: string,
  turnId: string,
  message: string
): Promise<{ status: number; frames: Frame[]; raw: string }> {
  const res = await fetch(`${BASE_URL}/api/v1/framework/facilitation/${SEAT}/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: BASE_URL },
    body: JSON.stringify({ message, turnId }),
  });
  const raw = await res.text();
  const isStream = (res.headers.get('content-type') ?? '').includes('text/event-stream');
  return { status: res.status, frames: isStream ? parseFrames(raw) : [], raw };
}

/** Remove anything a previous run left behind. `finally` cannot cover a SIGINT. */
async function sweep(): Promise<void> {
  // Cost rows are kept on user deletion (SET NULL), so they go by turn id.
  await prisma.aiCostLog.deleteMany({
    where: { metadata: { path: ['turnId'], string_starts_with: PREFIX } },
  });
  // Conversations, messages and turn records cascade with the account.
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

async function main(): Promise<void> {
  console.log(`\nsmoke:app-turn — target ${BASE_URL}\n`);

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
    // 1. A throwaway member. Signed up, verified in the database, signed in —
    //    so this behaves the same whether or not verification is required.
    const signup = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: 'Turn smoke' }),
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
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: EMAIL },
      select: { id: true },
    });
    console.log(`  ✓ signed in as ${EMAIL}`);

    // 2. The turn, once.
    console.log(`\n1. Turn ${TURN_ID}`);
    const first = await takeTurn(cookie, TURN_ID, MESSAGE);
    if (first.status !== 200) throw new Error(`first turn: ${first.status} ${first.raw}`);
    const firstDone = first.frames.find((frame) => frame.type === 'done');
    const firstError = first.frames.find((frame) => frame.type === 'error');
    if (firstError) throw new Error(`first turn ended in error: ${JSON.stringify(firstError)}`);
    check(firstDone !== undefined, 'the first request ran to `done`');
    check(firstDone?.model === PINNED_MODEL, `she answered on her pinned model (${PINNED_MODEL})`);
    const reply = replyOf(first.frames);
    check(reply.length > 0, `she said something (${reply.length} characters)`);
    // The wiring, asked directly. No turn row means the route ran the
    // framework's pass-through: the server booted without the leaf's hook — an
    // old process, or an `initApp()` that threw before registering it.
    const recorded = await prisma.appTurn.count({ where: { userId: user.id, turnId: TURN_ID } });
    if (recorded === 0) {
      throw new Error(
        'the route did not reach the turn hook — no app_turn row was written. Restart the server so instrumentation re-runs initApp(), and check its log for "initApp" errors.'
      );
    }
    check(recorded === 1, 'the route reached the leaf turn hook (a turn row exists)');

    // 3. The same turn, again.
    console.log('\n2. The same turn id, again');
    const second = await takeTurn(cookie, TURN_ID, MESSAGE);
    check(second.status === 200, 'the repeat is answered, not refused');
    check(replyOf(second.frames) === reply, 'with the first reply, word for word');

    // 4. What the database says happened.
    console.log('\n3. What was recorded');
    // The platform logs cost fire-and-forget; give the write a moment to land.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const tagged = await prisma.aiCostLog.findMany({
      where: { metadata: { path: ['turnId'], equals: TURN_ID } },
      select: { operation: true, model: true, totalCostUsd: true, metadata: true, userId: true },
    });
    const chatRows = tagged.filter((row) => row.operation === 'chat');
    check(chatRows.length === 1, `one chat cost row for two requests (found ${chatRows.length})`);
    check(
      chatRows[0].totalCostUsd > 0,
      `and it is not free: $${chatRows[0].totalCostUsd.toFixed(6)} on ${chatRows[0].model}`
    );
    check(
      tagged.every((row) => (row.metadata as { seat?: unknown } | null)?.seat === SEAT),
      `every tagged cost row carries the seat (${tagged.length} rows: ${tagged.map((row) => row.operation).join(', ')})`
    );
    check(
      tagged.every((row) => row.userId === user.id),
      'every tagged cost row is attributed to the member'
    );

    const turns = await prisma.appTurn.findMany({ where: { userId: user.id } });
    check(turns.length === 1, 'one turn record');
    const [turn] = turns;
    check(turn.status === 'completed' && turn.attempts === 1, 'completed, on its first attempt');
    check(turn.pricing === 'priced' && (turn.costUsd ?? 0) > 0, `priced at $${turn.costUsd}`);
    check(
      turn.fingerprintVersion !== null,
      `her fingerprint version recorded (v${turn.fingerprintVersion})`
    );
    check(turn.model === PINNED_MODEL && turn.provider === 'openai', 'model and provider recorded');
    check(turn.assistantMessageId !== null, 'her reply is linked');

    const userMessages = await prisma.aiMessage.findMany({
      where: { conversationId: turn.conversationId ?? '', role: 'user' },
      select: { metadata: true },
    });
    check(userMessages.length === 1, 'one message from the member, not two');
    const app = (userMessages[0].metadata as { app?: Record<string, unknown> } | null)?.app;
    check(
      app?.turnId === TURN_ID &&
        app?.seat === SEAT &&
        app?.fingerprintVersion === turn.fingerprintVersion,
      'the message carries turn id, seat and fingerprint version'
    );

    // 5. The same id with different words is a client bug, and is refused.
    console.log('\n4. The same id, different words');
    const reused = await takeTurn(cookie, TURN_ID, 'Something else entirely.');
    check(reused.status === 409, `refused with 409 (${reused.raw.slice(0, 120)})`);

    console.log('\n✓ smoke:app-turn passed\n');
  } finally {
    await sweep();
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('\n✗ smoke:app-turn failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
