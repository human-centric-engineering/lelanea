/**
 * Smoke: she notes what a person tells her, once — through the real route, in a
 * running app, against the dev database (f-slots t-72).
 *
 * **Why this exists rather than another unit test.** The chain under capture is
 * five things owned by three tiers meeting in one process: the grant her seed
 * wrote → Sunrise's dispatcher resolving that binding onto the execution context
 * → this leaf's `fill_slot` subclass being the handler the dispatcher actually
 * holds → Daybreak's exposure allowlist and value engine → a `capability_result`
 * frame on the stream. Every join is a place a mock would agree with itself. Two
 * of them have already failed in exactly that way: the subclass silently refused
 * registration for an inherited redactor, and the turn id reaches the capability
 * only because Sunrise's chat handler threads `costLogMetadata` onto the
 * dispatch context — a carrier declared for something else, which no test of
 * ours owns.
 *
 * **And `HB9`: this is the only thing that proves the write.** The panel a person
 * reads it in is t-73. Until that lands, a slot value is written where nobody can
 * see it, which is indistinguishable from not being written at all.
 *
 * Flow:
 *   1. Sign up a throwaway member, verify it in the database, sign in.
 *   2. Tell her something the taxonomy covers, in plain words, with a turn id.
 *   3. Assert: a `framework_slot_value` for that person, carrying the
 *      conversation it came from, a confidence and a `sourceType`; the stream
 *      carried a `capability_result` for `fill_slot`; the account line says she
 *      added something.
 *   4. Write one slot TWICE under one turn id, through the real dispatcher
 *      against the real database. Assert one version, not two — the guard, on a
 *      real unique index rather than a fake one — and that a different turn id
 *      writing the same slug still appends, so the guard is keyed on the turn.
 *   5. Assert what she may NOT read back: `get_state` returns no `development`
 *      slot even with one written, because §12 says that is never a grade.
 *   6. Remove the member (which cascades the turns, the guard rows and the slot
 *      values), and the cost rows.
 *
 * Needs: a server (`npm run dev`), the seeds applied (`npm run db:seed` — she
 * must be public, seated, and hold both slot tools from
 * `013-agent-slot-tools`), and a working OpenAI key under the `openai` provider
 * slug. Against the proxied `https://lelanea.test`, Node must trust the local CA
 * from the system store: `NODE_OPTIONS=--use-system-ca npm run
 * smoke:app-slot-capture`. It costs two real model calls — about $0.002.
 *
 * **It changes no shared row.** Unlike `smoke:app-turn` it never touches her
 * provider or the pause switch, so it is safe to run while somebody is using the
 * app.
 *
 * Safety: every row is scoped by the `smoke-test-slots` prefix or by this run's
 * turn ids, and removed on every path, including a sweep at startup for anything
 * an interrupted run stranded. Never touches seed data, never deletes unscoped.
 *
 * **What it cannot prove, and what does:** that the MODEL chooses to capture the
 * right things at the right confidence. That is her voice and her judgement, and
 * it is measured by the golden set (`npm run smoke:app-voice`), re-run with these
 * tools granted. This script asserts the mechanism carries whatever she decides.
 *
 * Run with: npm run smoke:app-slot-capture
 */

import { prisma } from '@/lib/db/client';
import { isRecord } from '@/lib/utils';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';
import { SLOT_EXPOSURE_CONFIG } from '@/lib/app/agent/pins';
import { getSlotTaxonomy } from '@/lib/app/content/slot-taxonomy';
import { accountLine, accountParts } from '@/lib/app/conversation/account';
import { capabilityDispatcher } from '@/lib/orchestration/capabilities/dispatcher';
import { registerBuiltInCapabilities } from '@/lib/orchestration/capabilities/registry';

const BASE_URL =
  process.env.SMOKE_BASE_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
const PREFIX = 'smoke-test-slots';
const EMAIL = `${PREFIX}@example.com`;
const PASSWORD = 'SmokeTest!Passw0rd';
const SEAT = 'onboarding';
const RUN = Date.now();
const TURN_CAPTURE = `${PREFIX}-capture-${RUN}`;
const TURN_RETRY = `${PREFIX}-retry-${RUN}`;

/**
 * Something the taxonomy covers, said plainly and unprompted, with no
 * instruction in it.
 *
 * Deliberately not phrased as a request to remember anything: an instruction in
 * user text is data, never a command (§8.6), and a message that ASKED her to
 * record something would prove the wrong thing — that she follows instructions
 * from the body, which is the property the voice layer forbids.
 */
const MESSAGE =
  'I want to be honest with you about where I am. My brother and I have not spoken since our father died two years ago, and it sits under everything else.';

interface Frame {
  type: string;
  [key: string]: unknown;
}

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

function note(msg: string): void {
  console.log(`  · ${msg}`);
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
 * The capability slugs a stream reported as having ANSWERED, from either frame
 * shape the handler emits (one call, or several).
 *
 * Read the same way the account under a reply reads it — a result that refused
 * or failed is not something the turn did.
 */
function answeredOnStream(frames: Frame[]): string[] {
  const answered: string[] = [];
  for (const frame of frames) {
    const results =
      frame.type === 'capability_results' && Array.isArray(frame.results)
        ? frame.results
        : frame.type === 'capability_result'
          ? [frame]
          : [];
    for (const entry of results) {
      if (!isRecord(entry)) continue;
      const slug = entry.capabilitySlug;
      const result = entry.result;
      if (typeof slug === 'string' && isRecord(result) && result.success === true) {
        answered.push(slug);
      }
    }
  }
  return answered;
}

/** Her slot values, newest first. */
function slotValuesFor(userId: string) {
  return prisma.slotValue.findMany({
    where: { userId },
    orderBy: [{ slotSlug: 'asc' }, { version: 'asc' }],
    select: {
      slotSlug: true,
      version: true,
      value: true,
      confidence: true,
      sourceType: true,
      provenance: true,
      capturedAt: true,
    },
  });
}

async function removeMember(): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (!user) return;
  // Slot values are not cascade-linked to the account in the framework's schema
  // the way the turns are, so they are removed explicitly rather than assumed.
  await prisma.slotValue.deleteMany({ where: { userId: user.id } });
  await prisma.aiCostLog.deleteMany({ where: { userId: user.id } });
  // `eraseUser()` is the production path; this is a smoke's own throwaway row,
  // and deleting it exercises the cascade chain this task added
  // (`user` → `app_turn` → `app_turn_slot_write`) rather than bypassing it.
  await prisma.user.delete({ where: { id: user.id } });
}

/** Anything an interrupted run left behind. */
async function sweep(): Promise<void> {
  await removeMember();
}

async function main(): Promise<void> {
  console.log(`\nsmoke:app-slot-capture — target ${BASE_URL}\n`);

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

  // This process dispatches a capability itself in step 3, so it needs the same
  // registration the server does — `initApp()` for the framework tier's
  // capabilities, then the built-in/app flush that mounts ours over Daybreak's.
  const { initApp } = await import('@/lib/app/bootstrap');
  await initApp();
  registerBuiltInCapabilities();

  try {
    // ---- 0. The grant her seed wrote, read off the real database -------------
    //
    // Asked before anything is spent. A missing grant means `013` has not run
    // here, and every assertion below would fail for that reason with a message
    // about slot values instead.
    console.log('0. Her grants');
    const agent = await prisma.aiAgent.findFirst({
      where: { slug: VOICE_AGENT_SLUG, deletedAt: null },
      select: {
        id: true,
        capabilities: {
          select: { isEnabled: true, customConfig: true, capability: { select: { slug: true } } },
        },
      },
    });
    if (!agent) throw new Error(`no agent ${VOICE_AGENT_SLUG} — run npm run db:seed`);
    const bound = new Map(
      agent.capabilities.map((row) => [row.capability.slug, row] as const)
    );
    for (const slug of ['fill_slot', 'get_state']) {
      const row = bound.get(slug);
      if (!row?.isEnabled) {
        throw new Error(
          `${slug} is not granted to ${VOICE_AGENT_SLUG} (or is switched off) — run npm run db:seed so 013-agent-slot-tools applies, then restart the server so the dispatcher's 5-minute binding cache clears.`
        );
      }
      check(true, `${slug} is granted and switched on`);
    }
    const captureConfig = bound.get('fill_slot')?.customConfig;
    check(
      isRecord(captureConfig) && captureConfig.write === undefined,
      'the write half of her allowlist is absent, so she may still mint a slot'
    );
    note(`she may read back: ${SLOT_EXPOSURE_CONFIG.read.groups.join(', ')}`);

    // ---- 1. A throwaway member ---------------------------------------------
    const signup = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: 'Slots smoke' }),
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
    console.log(`\n  ✓ signed in as ${EMAIL}`);

    // ---- 2. She is told something that matters ------------------------------
    console.log(`\n1. A turn that says something worth keeping (${TURN_CAPTURE})`);
    const first = await takeTurn(cookie, TURN_CAPTURE, MESSAGE);
    if (first.status !== 200) throw new Error(`turn failed: ${first.status} ${first.raw}`);
    const error = first.frames.find((frame) => frame.type === 'error');
    if (error) throw new Error(`the turn ended in error: ${JSON.stringify(error)}`);
    check(
      first.frames.some((frame) => frame.type === 'done'),
      'the turn ran to `done`'
    );

    const answered = answeredOnStream(first.frames);
    note(`the stream reported: ${answered.join(', ') || '(no capability)'}`);
    // NOT a hard assertion on the model's judgement — whether she reaches for
    // the tool on this message is her decision, and the golden set is what
    // measures it. What must hold is the implication: a value in the database
    // and no frame, or a frame and no value, is the wiring being wrong.
    const values = await slotValuesFor(user.id);
    const wroteOnStream = answered.filter((slug) => slug === 'fill_slot').length;

    if (values.length === 0) {
      throw new Error(
        `she captured nothing from a message the taxonomy covers. The wiring may be right and her judgement wrong — check the server log for a fill_slot dispatch. If there is none, she was never told to note things: check VOICE_AGENT_SYSTEM_INSTRUCTIONS reached her row (npm run db:seed re-runs 003) and that the server restarted since. Stream reported: ${answered.join(', ') || 'nothing'}.`
      );
    }
    check(values.length > 0, `she noted ${values.length} thing(s)`);
    check(
      wroteOnStream > 0,
      'the write reached the stream as a capability result, so the account can read it'
    );
    check(
      wroteOnStream === values.length,
      `every write she made is on the stream (${wroteOnStream} frames, ${values.length} values)`
    );

    console.log('\n2. What each one carries');
    const turnRow = await prisma.appTurn.findUniqueOrThrow({
      where: { userId_turnId: { userId: user.id, turnId: TURN_CAPTURE } },
      select: { id: true, conversationId: true },
    });
    for (const value of values) {
      note(`${value.slotSlug} v${value.version}: "${value.value.slice(0, 70)}"`);
      check(
        value.confidence >= 1 && value.confidence <= 10,
        `${value.slotSlug} carries a confidence (${value.confidence})`
      );
      check(
        typeof value.sourceType === 'string' && value.sourceType.length > 0,
        `${value.slotSlug} says how it was captured (${value.sourceType})`
      );
      check(
        isRecord(value.provenance) && value.provenance.conversationId === turnRow.conversationId,
        `${value.slotSlug} names the conversation it came from`
      );
      check(value.version === 1, `${value.slotSlug} is at version 1 — nothing was overwritten`);
    }

    // The guard's own ledger, one row per write.
    const guardRows = await prisma.appTurnSlotWrite.findMany({
      where: { turnId: turnRow.id },
      select: { slotSlug: true, version: true },
    });
    check(
      guardRows.length === values.length,
      `the turn recorded each write it made (${guardRows.length} guard rows)`
    );

    // The sentence a person actually reads under the reply (§10 t-66).
    const line = accountLine(
      accountParts({ at: new Date().toISOString(), capabilities: answered, citations: [], turn: null })
    );
    note(`the account under her reply reads: "${line}"`);
    check(
      /what she understands about you/.test(line),
      'the account tells the person something was noted'
    );
    for (const value of values) {
      check(!line.includes(value.slotSlug), `the account does not name the slug ${value.slotSlug}`);
    }

    // ---- 3. The retry — the defect §8.1 names ------------------------------
    //
    // **Dispatched directly rather than driven through the route, on purpose.**
    // Provoking the double-write through two HTTP turns needs the MODEL to
    // attempt the same write twice, and it will not: told not to repeat a
    // reading it has already recorded in this conversation, and holding
    // `get_state` to check, it declines — correct behaviour that leaves the
    // load-bearing case unrun. An earlier version of this script skipped the
    // whole section on that, and printed "all good" having proved nothing
    // (`fp6`: an absence over an empty population is not evidence).
    //
    // So the second write is made deliberately, through the REAL dispatcher
    // against the REAL database, under the turn id of the turn that just ran —
    // which is exactly the state a re-claimed failed turn is in. Everything the
    // unit test has to fake is real here: the binding and its allowlist, the
    // value engine's version chain, and the unique index that is the guard.
    console.log('\n3. The same turn, writing the same slot twice');
    const target = await prisma.slotDefinition.findFirstOrThrow({
      where: { isActive: true, group: { in: [...SLOT_EXPOSURE_CONFIG.read.groups] } },
      select: { slug: true },
      orderBy: { slug: 'asc' },
    });
    const dispatchContext = {
      userId: user.id,
      agentId: agent.id,
      conversationId: turnRow.conversationId ?? undefined,
      // The carrier the chat handler threads and the turn seam fills — the only
      // route a turn id has to a capability today. If this stops arriving, the
      // guard stops guarding, and this assertion is what says so.
      costLogMetadata: { turnId: TURN_CAPTURE, seat: SEAT },
    };
    const args = {
      slotSlug: target.slug,
      value: 'A reading written twice under one turn id, by the capture smoke.',
      confidence: 6,
      reasoningNote: 'Written by npm run smoke:app-slot-capture.',
      sourceType: 'inferred',
    };

    const firstWrite = await capabilityDispatcher.dispatch('fill_slot', args, dispatchContext);
    check(firstWrite.success, `the first write of ${target.slug} succeeded`);
    const afterFirst = await slotValuesFor(user.id);
    const firstVersions = afterFirst.filter((value) => value.slotSlug === target.slug);
    check(firstVersions.length === 1, `${target.slug} is written once, at v${firstVersions[0]?.version}`);

    const secondWrite = await capabilityDispatcher.dispatch('fill_slot', args, dispatchContext);
    const afterSecond = await slotValuesFor(user.id);
    const secondVersions = afterSecond.filter((value) => value.slotSlug === target.slug);

    // The population is non-empty — the first write landed — so this absence
    // means something.
    check(
      secondVersions.length === 1,
      `the second write added no version (${firstVersions.length} before, ${secondVersions.length} after)`
    );
    check(
      secondVersions[0]?.version === firstVersions[0]?.version,
      'and the stored version is the one the first write made'
    );
    // Not an error: the reading IS recorded, which is what the model asked for.
    check(secondWrite.success, 'the suppressed write answers success, not a refusal');
    check(
      isRecord(secondWrite.data) && secondWrite.data.version === firstVersions[0]?.version,
      'and answers with the version that actually exists'
    );
    // The turn's own ledger did not grow either.
    const guardAfter = await prisma.appTurnSlotWrite.count({
      where: { turnId: turnRow.id, slotSlug: target.slug },
    });
    check(guardAfter === 1, 'the turn recorded that slot once');

    // And the guard is keyed on the TURN, not on the slot: a different turn id
    // writing the same slug is a genuine second reading and must still land.
    const otherTurn = await prisma.appTurn.create({
      data: {
        userId: user.id,
        turnId: TURN_RETRY,
        clientSupplied: true,
        requestHash: 'smoke-not-a-real-request',
        seat: SEAT,
        agentSlug: VOICE_AGENT_SLUG,
        conversationId: turnRow.conversationId,
      },
      select: { id: true },
    });
    const thirdWrite = await capabilityDispatcher.dispatch('fill_slot', args, {
      ...dispatchContext,
      costLogMetadata: { turnId: TURN_RETRY, seat: SEAT },
    });
    check(thirdWrite.success, 'a different turn writing the same slot is not suppressed');
    const afterThird = (await slotValuesFor(user.id)).filter(
      (value) => value.slotSlug === target.slug
    );
    check(
      afterThird.length === 2,
      `it appends a genuine second reading (now ${afterThird.length} versions)`
    );
    check(
      (await prisma.appTurnSlotWrite.count({ where: { turnId: otherTurn.id } })) === 1,
      'and that turn records its own write'
    );

    // ---- 4. What she may not read back ------------------------------------
    console.log('\n4. What the allowlist withholds from her');
    const hiddenGroups = new Set(
      getSlotTaxonomy()
        .slots.filter((slot) => slot.visibility === 'hidden')
        .map((slot) => slot.group)
    );
    check(hiddenGroups.size > 0, `the taxonomy hides ${hiddenGroups.size} group(s)`);
    for (const group of hiddenGroups) {
      check(
        !SLOT_EXPOSURE_CONFIG.read.groups.includes(group),
        `"${group}" is write-only to her — §12, never a grade`
      );
    }

    console.log('\nall good.\n');
  } finally {
    await removeMember();
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
  void prisma.$disconnect();
});
