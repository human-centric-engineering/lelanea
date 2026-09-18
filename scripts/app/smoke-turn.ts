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
 *
 * And when she can't answer (§08 t-55):
 *   6. Drop the connection after her first words. The turn still completes and
 *      is recorded `completed`; the retry is a replay — one model call, one cost
 *      row, one user message.
 *   7. Point her at an unreachable endpoint (a throwaway provider row whose host
 *      cannot resolve). The turn ends with the plain `unavailable` ending, and no
 *      frame names the provider or its host; the person's message is kept; the
 *      read routes answer 200; the status read says `unavailable`. Point her back
 *      and the same turn id runs.
 *   8. Pause generation. The turn is refused before any model call — no turn
 *      row, no cost row — with the `paused` ending; the status read says
 *      `paused`; the read routes answer 200.
 *   9. Remove the member, the cost rows, the throwaway provider, and put her
 *      provider and the pause switch back.
 *
 * Needs: a server (`npm run dev`), the seeds applied (`npm run db:seed` — she
 * must be public and seated, and the pause flag must exist), and a working
 * OpenAI key under the `openai` provider slug. It costs three real model calls —
 * about $0.002.
 *
 * **It changes two shared rows while it runs**: her agent's provider (step 7)
 * and the pause switch (step 8). Both are put back in `finally`, and the startup
 * sweep puts them back after an interrupted run — her provider by the throwaway
 * slug, the switch by the `setBy` marker this script writes into its metadata. A
 * turn someone else takes in those seconds meets the same condition.
 *
 * Safety: every row is scoped by the `smoke-test-turn` prefix or by this run's
 * turn id, and removed on every path, including a sweep at startup for anything
 * an interrupted run stranded. Never touches seed data, never deletes unscoped.
 *
 * Run with: npm run smoke:app-turn
 */

import { prisma } from '@/lib/db/client';
import { isRecord } from '@/lib/utils';
import { PINNED_MODEL, PINNED_PROVIDER } from '@/lib/app/agent/pinned-model';
import { GENERATION_PAUSED_FLAG } from '@/lib/app/agent/availability';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';

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
/** A provider that cannot be reached: `.invalid` never resolves (RFC 2606). */
const UNREACHABLE_PROVIDER = `${PREFIX}-unreachable`;
const UNREACHABLE_HOST = 'lelanea-smoke.invalid';
/** Marks a pause this script switched on, so a sweep can tell it from an operator's. */
const PAUSE_MARKER = { setBy: 'smoke:app-turn' };

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

/**
 * Take a turn and hang up after her first words — a person whose connection
 * drops mid-answer. Returns the frames that arrived before the drop.
 */
async function takeTurnAndDrop(cookie: string, turnId: string, message: string): Promise<Frame[]> {
  const controller = new AbortController();
  const res = await fetch(`${BASE_URL}/api/v1/framework/facilitation/${SEAT}/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: BASE_URL },
    body: JSON.stringify({ message, turnId }),
    signal: controller.signal,
  });
  if (!res.body) throw new Error(`drop turn: no body (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('the turn finished before any words arrived to drop after');
      raw += decoder.decode(value, { stream: true });
      const frames = parseFrames(raw.slice(0, raw.lastIndexOf('\n\n') + 2));
      if (frames.some((frame) => frame.type === 'content')) {
        controller.abort();
        return frames;
      }
    }
  } catch (err) {
    if (controller.signal.aborted) return parseFrames(raw.slice(0, raw.lastIndexOf('\n\n') + 2));
    throw err;
  }
}

/** Poll until a turn row settles, or give up after `timeoutMs`. */
async function waitForSettled(userId: string, turnId: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const turn = await prisma.appTurn.findUnique({
      where: { userId_turnId: { userId, turnId } },
    });
    if (turn && turn.status !== 'running') return turn;
    if (Date.now() > deadline) throw new Error(`turn ${turnId} still running after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** Every read route a member uses between conversations: path → status. */
async function readRoutes(cookie: string): Promise<Record<string, number>> {
  const paths = [
    '/api/v1/app/content/documents',
    '/api/v1/app/content/documents/the_mission',
    '/api/v1/app/content/journey-structure',
    '/api/v1/app/content/discovery-questions',
    '/api/v1/app/journey/map',
  ];
  const statuses: Record<string, number> = {};
  for (const path of paths) {
    const res = await fetch(`${BASE_URL}${path}`, { headers: { cookie } });
    statuses[path] = res.status;
  }
  return statuses;
}

async function generationStatus(cookie: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}/api/v1/app/agent/status`, { headers: { cookie } });
  const body: unknown = await res.json();
  return isRecord(body) && isRecord(body.data) ? body.data.generation : undefined;
}

function userMessagesFor(turnId: string): Promise<number> {
  return prisma.aiMessage.count({
    where: { role: 'user', metadata: { path: ['app', 'turnId'], equals: turnId } },
  });
}

function chatCostRowsFor(turnId: string): Promise<number> {
  return prisma.aiCostLog.count({
    where: { operation: 'chat', metadata: { path: ['turnId'], equals: turnId } },
  });
}

/** Put back the two shared rows this script changes. Safe to call when it changed neither. */
async function restoreSharedRows(): Promise<void> {
  await prisma.aiAgent.updateMany({
    where: { slug: VOICE_AGENT_SLUG, provider: UNREACHABLE_PROVIDER },
    data: { provider: PINNED_PROVIDER },
  });
  await prisma.aiProviderConfig.deleteMany({ where: { slug: UNREACHABLE_PROVIDER } });
  const flag = await prisma.featureFlag.findUnique({ where: { name: GENERATION_PAUSED_FLAG } });
  const metadata = flag?.metadata;
  if (flag?.enabled && isRecord(metadata) && metadata.setBy === PAUSE_MARKER.setBy) {
    await prisma.featureFlag.update({
      where: { name: GENERATION_PAUSED_FLAG },
      data: { enabled: false, metadata: {} },
    });
  }
}

/** Remove anything a previous run left behind. `finally` cannot cover a SIGINT. */
async function sweep(): Promise<void> {
  await restoreSharedRows();
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
    check(
      turn.modelId === PINNED_MODEL && turn.providerSlug === 'openai',
      'model and provider recorded'
    );
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
    check(
      reused.status === 409,
      `refused with 409 (${reused.status}: ${reused.raw.slice(0, 400)})`
    );

    // 6. The connection drops after her first words. Owner ruling (18 Sept
    //    2026): that does not stop her answer.
    console.log('\n5. The connection drops mid-answer');
    const dropId = `${PREFIX}-drop-${Date.now()}`;
    const beforeDrop = await takeTurnAndDrop(cookie, dropId, 'Tell me slowly: what happens first?');
    check(
      beforeDrop.some((frame) => frame.type === 'content'),
      'hung up after her first words'
    );
    const dropped = await waitForSettled(user.id, dropId);
    check(
      dropped.status === 'completed' && dropped.attempts === 1,
      `the turn ran on without its reader and was recorded completed (${dropped.status})`
    );
    const afterDrop = await takeTurn(cookie, dropId, 'Tell me slowly: what happens first?');
    check(
      afterDrop.frames.at(-1)?.type === 'done' && replyOf(afterDrop.frames).length > 0,
      'the retry is answered in full'
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    check(
      (await chatCostRowsFor(dropId)) === 1,
      'one model call for the dropped turn and its retry'
    );
    check((await userMessagesFor(dropId)) === 1, 'one message from the member, not two');
    const replayed = await prisma.appTurn.findUniqueOrThrow({
      where: { userId_turnId: { userId: user.id, turnId: dropId } },
    });
    check(replayed.attempts === 1, 'the retry was a replay, not a re-run');

    // 7. Her model unreachable.
    console.log('\n6. Her model pointed at an unreachable endpoint');
    await prisma.aiProviderConfig.create({
      data: {
        name: `${PREFIX} unreachable`,
        slug: UNREACHABLE_PROVIDER,
        providerType: 'openai-compatible',
        baseUrl: `http://${UNREACHABLE_HOST}/v1`,
        // Local, so no key is needed — and none is sent anywhere.
        isLocal: true,
        isActive: true,
        timeoutMs: 5_000,
        maxRetries: 0,
      },
    });
    await prisma.aiAgent.update({
      where: { slug: VOICE_AGENT_SLUG },
      data: { provider: UNREACHABLE_PROVIDER },
    });
    const downId = `${PREFIX}-down-${Date.now()}`;
    const downMessage = 'Are you there?';
    const down = await takeTurn(cookie, downId, downMessage);
    check(down.status === 200, `the turn is answered, not errored (${down.status})`);
    const ending = down.frames.at(-1);
    check(
      ending?.type === 'error' && ending.code === 'unavailable',
      `it ends with the plain ending: ${JSON.stringify(ending)}`
    );
    check(
      !down.raw.includes(UNREACHABLE_PROVIDER) && !down.raw.includes(UNREACHABLE_HOST),
      'no frame names the provider or its host'
    );
    const downTurn = await waitForSettled(user.id, downId);
    check(downTurn.status === 'failed', `the turn is failed and retryable (${downTurn.errorCode})`);
    check((await userMessagesFor(downId)) === 1, 'what the member typed is kept server-side');
    const whileDown = await readRoutes(cookie);
    check(
      Object.values(whileDown).every((status) => status === 200),
      `every read route answers 200 (${JSON.stringify(whileDown)})`
    );
    const statusWhileDown = await generationStatus(cookie);
    check(
      statusWhileDown === 'unavailable',
      `the status read says unavailable (${String(statusWhileDown)})`
    );

    await restoreSharedRows();
    const back = await takeTurn(cookie, downId, downMessage);
    check(back.frames.at(-1)?.type === 'done', 'pointed back, the same turn id runs');
    const backTurn = await prisma.appTurn.findUniqueOrThrow({
      where: { userId_turnId: { userId: user.id, turnId: downId } },
    });
    check(
      backTurn.status === 'completed' && backTurn.attempts === 2,
      'completed, on its second attempt'
    );

    // 8. Paused on purpose.
    console.log('\n7. Generation paused');
    const flag = await prisma.featureFlag.findUnique({ where: { name: GENERATION_PAUSED_FLAG } });
    if (!flag) throw new Error(`no ${GENERATION_PAUSED_FLAG} flag — run npm run db:seed`);
    if (flag.enabled) throw new Error('generation is already paused here — not touching it');
    await prisma.featureFlag.update({
      where: { name: GENERATION_PAUSED_FLAG },
      data: { enabled: true, metadata: PAUSE_MARKER },
    });
    const pausedId = `${PREFIX}-paused-${Date.now()}`;
    const paused = await takeTurn(cookie, pausedId, 'Hello?');
    check(
      paused.frames.length === 1 &&
        paused.frames[0].type === 'error' &&
        paused.frames[0].code === 'paused',
      `refused with the paused ending: ${JSON.stringify(paused.frames)}`
    );
    const pausedRows = await prisma.appTurn.count({ where: { userId: user.id, turnId: pausedId } });
    check(pausedRows === 0, 'nothing was claimed');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const pausedCosts = await prisma.aiCostLog.count({
      where: { metadata: { path: ['turnId'], equals: pausedId } },
    });
    check(pausedCosts === 0, 'and nothing was billed — no model call');
    const statusPaused = await generationStatus(cookie);
    check(statusPaused === 'paused', `the status read says paused (${String(statusPaused)})`);
    const whilePaused = await readRoutes(cookie);
    check(
      Object.values(whilePaused).every((status) => status === 200),
      `every read route answers 200 (${JSON.stringify(whilePaused)})`
    );
    await restoreSharedRows();

    console.log('\n✓ smoke:app-turn passed\n');
  } finally {
    await sweep().catch((err: unknown) => console.error('sweep failed:', err));
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('\n✗ smoke:app-turn failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
