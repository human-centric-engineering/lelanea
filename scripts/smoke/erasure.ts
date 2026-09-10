/**
 * Account-erasure smoke script.
 *
 * Proves the DB-enforced erasure behavior that mocked unit/integration tests
 * cannot: `ON DELETE CASCADE` removes personal data, `ON DELETE SET NULL`
 * retains org config with a nulled creator, residual `clientIp` is scrubbed,
 * and a `DataErasureReceipt` is written. Runs against the real dev/CI Postgres.
 *
 * It also proves the other edge of the cascade: system-owned inbound data —
 * a third party's SMS thread and the run it started — SURVIVES erasing the
 * operator whose agent and workflow it hangs off. That is the half a mocked
 * test cannot reach, because the deletion it guards against is performed by
 * Postgres rather than by any line of application code (#502).
 *
 * Skips cleanly (exit 0) when no database is reachable, so it is safe to invoke
 * anywhere — it only does real work where a DB exists (CI's `validate` job,
 * which provisions Postgres + migrations + seeds, and locally with a running
 * DB). It must NOT be wired into `docker build` / `next build` (no DB there).
 *
 * Self-cleaning: creates only `smoke-test-erasure-*` rows and removes whatever
 * it created on every path. Never uses unscoped deletes or touches seed data.
 *
 * Run with:
 *   npm run smoke:erasure
 *   npx tsx --env-file=.env.local scripts/smoke/erasure.ts
 */

import { prisma } from '@/lib/db/client';
import { eraseUser } from '@/lib/privacy/erase-user';
import { createJourney } from '@/lib/framework/facilitation/journey/create';

const PREFIX = 'smoke-test-erasure';
const stamp = Date.now();

async function dbReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main(): Promise<void> {
  if (!(await dbReachable())) {
    console.log('smoke:erasure skipped — no database reachable (DATABASE_URL unset or DB down).');
    return;
  }

  let subjectUserId: string | null = null;
  let agentId: string | null = null;
  let auditId: string | null = null;
  let receiptId: string | null = null;
  let datasetId: string | null = null;
  let runId: string | null = null;
  let slotValueId: string | null = null;
  let journeyId: string | null = null;
  let nodeStateId: string | null = null;
  let journeyEventLinkedId: string | null = null;
  let journeyEventEngagementId: string | null = null;
  let inboundConversationId: string | null = null;
  let inboundExecutionId: string | null = null;
  let workflowId: string | null = null;

  try {
    // Subject (ADMIN so we also prove a config-creator's createdBy is nulled).
    const subject = await prisma.user.create({
      data: {
        name: `${PREFIX} subject`,
        email: `${PREFIX}-subject-${stamp}@example.com`,
        role: 'ADMIN',
      },
    });
    subjectUserId = subject.id;

    // Org config (retained → createdBy SetNull) + personal data (cascade).
    const agent = await prisma.aiAgent.create({
      data: {
        name: `${PREFIX} agent`,
        slug: `${PREFIX}-agent-${stamp}`,
        description: 'smoke',
        systemInstructions: 'smoke',
        model: '',
        createdBy: subject.id,
      },
    });
    agentId = agent.id;

    const conversation = await prisma.aiConversation.create({
      data: { userId: subject.id, agentId: agent.id, title: 'smoke convo' },
    });
    const message = await prisma.aiMessage.create({
      data: { conversationId: conversation.id, role: 'user', content: 'hi' },
    });

    // Framework slot value — personal data via a hand-written ON DELETE CASCADE FK
    // (plain scalar `userId`, no @relation; f-slots t-2). Proves the cascade fires.
    const slotValue = await prisma.slotValue.create({
      data: {
        userId: subject.id,
        slotSlug: `${PREFIX}-slot-${stamp}`,
        version: 1,
        value: 'smoke value',
        confidence: 5,
        sourceType: 'direct',
        reasoningNote: 'smoke',
        provenance: {},
      },
    });
    slotValueId = slotValue.id;

    // Framework journey state (f-journey-state t-1). `UserJourney.userId` +
    // `JourneyEvent.userId` are hand-written ON DELETE CASCADE FKs to `user`;
    // `UserNodeState` cascades via its journey. We seed TWO events — one linked to
    // the journey, one a non-journey engagement event (journeyId null, reachable
    // only via the userId FK) — to prove BOTH erasure paths.
    // Started through the framework seam (#159), not `prisma.userJourney.create` —
    // which also proves the row the seam mints is erasable by the FKs below.
    const journey = await createJourney(
      { userId: subject.id },
      { userId: subject.id, graphSlug: `${PREFIX}-graph-${stamp}` }
    );
    journeyId = journey.id;
    const nodeState = await prisma.userNodeState.create({
      data: { journeyId: journey.id, nodeKey: `${PREFIX}-node`, status: 'active' },
    });
    nodeStateId = nodeState.id;
    const journeyEventLinked = await prisma.journeyEvent.create({
      data: {
        userId: subject.id,
        journeyId: journey.id,
        nodeKey: `${PREFIX}-node`,
        type: 'node_entered',
      },
    });
    journeyEventLinkedId = journeyEventLinked.id;
    const journeyEventEngagement = await prisma.journeyEvent.create({
      // journeyId left null — a non-journey engagement event (§4.3, f-engagement): a
      // `module.feedback` row carrying a free-text comment (PII) in its payload. Erasable
      // ONLY via the userId hand-FK; this is the row a journeyId-only table would leak,
      // and it proves the comment PII goes with it on erasure.
      data: {
        userId: subject.id,
        moduleSlug: `${PREFIX}-module`,
        type: 'module.feedback',
        payload: { rating: 5, comment: `${PREFIX}-loved-the-coaching` },
      },
    });
    journeyEventEngagementId = journeyEventEngagement.id;

    // A third party's inbound thread and run, on an agent and workflow the
    // subject created. System-owned (`userId: null`) since #502, and they must
    // SURVIVE the subject's erasure: nothing here is the subject's to erase.
    //
    // This is the assertion the whole issue turns on. While these rows carried
    // `userId = trigger.createdBy`, the `Cascade` FK meant erasing one operator
    // silently destroyed every customer conversation routed through any trigger
    // they had configured — `eraseUser()` returned success and the
    // correspondence was gone. Planting them against the subject's own agent
    // and workflow is deliberate: those relations are the remaining paths a
    // cascade could still reach them by.
    const inboundConversation = await prisma.aiConversation.create({
      data: {
        userId: null,
        agentId: agent.id,
        title: `${PREFIX} inbound thread`,
        channel: 'sms',
        provider: 'twilio',
        fromAddress: `+1555${String(stamp).slice(-7)}`,
      },
    });
    inboundConversationId = inboundConversation.id;
    const inboundMessage = await prisma.aiMessage.create({
      data: {
        conversationId: inboundConversation.id,
        role: 'user',
        content: 'third party inbound text',
      },
    });

    const workflow = await prisma.aiWorkflow.create({
      data: {
        name: `${PREFIX} workflow`,
        slug: `${PREFIX}-workflow-${stamp}`,
        description: 'smoke',
        createdBy: subject.id,
      },
    });
    workflowId = workflow.id;
    const inboundExecution = await prisma.aiWorkflowExecution.create({
      data: {
        workflowId: workflow.id,
        status: 'completed',
        inputData: { trigger: { text: 'third party inbound text' } },
        executionTrace: [],
        triggerSource: 'inbound:sms',
        userId: null,
      },
    });
    inboundExecutionId = inboundExecution.id;

    // Retained audit row carrying the subject's IP (residual PII to scrub).
    const audit = await prisma.aiAdminAuditLog.create({
      data: {
        userId: subject.id,
        action: 'agent.create',
        entityType: 'agent',
        clientIp: '203.0.113.7',
      },
    });
    auditId = audit.id;

    // Evaluations (merged from main): dataset = reusable asset (retain/SetNull),
    // run = the user's run history (cascade, results cascade from the run).
    const dataset = await prisma.aiDataset.create({
      data: { userId: subject.id, name: `${PREFIX} dataset`, contentHash: 'smoke-hash' },
    });
    datasetId = dataset.id;
    const run = await prisma.aiEvaluationRun.create({
      data: {
        userId: subject.id,
        name: `${PREFIX} run`,
        subjectKind: 'agent',
        agentId: agent.id,
        datasetId: dataset.id,
        datasetContentHash: 'smoke-hash',
        metricConfigs: [],
      },
    });
    runId = run.id;

    // Erase.
    const result = await eraseUser({
      userId: subject.id,
      userEmail: subject.email,
      actorUserId: subject.id,
      reason: 'self_service',
    });
    receiptId = result.receiptId;

    // Personal data cascaded away.
    check(
      (await prisma.user.findUnique({ where: { id: subject.id } })) === null,
      'user row deleted'
    );
    check(
      (await prisma.aiConversation.findUnique({ where: { id: conversation.id } })) === null,
      'conversation cascade-deleted'
    );
    check(
      (await prisma.aiMessage.findUnique({ where: { id: message.id } })) === null,
      'message cascade-deleted via its conversation'
    );
    check(
      (await prisma.slotValue.findUnique({ where: { id: slotValue.id } })) === null,
      'framework slot value cascade-deleted (hand-written ON DELETE CASCADE)'
    );
    check(
      (await prisma.userJourney.findUnique({ where: { id: journey.id } })) === null,
      'framework user journey cascade-deleted (hand-written ON DELETE CASCADE)'
    );
    check(
      (await prisma.userNodeState.findUnique({ where: { id: nodeState.id } })) === null,
      'framework user node state cascade-deleted (via its journey)'
    );
    check(
      (await prisma.journeyEvent.findUnique({ where: { id: journeyEventLinked.id } })) === null,
      'framework journey event (journey-linked) cascade-deleted'
    );
    check(
      (await prisma.journeyEvent.findUnique({ where: { id: journeyEventEngagement.id } })) === null,
      'framework journey event (null-journeyId engagement) cascade-deleted via its userId FK'
    );

    // Org config retained, creator de-attributed.
    const agentAfter = await prisma.aiAgent.findUnique({ where: { id: agent.id } });
    check(agentAfter !== null, 'agent retained');
    check(agentAfter?.createdBy === null, 'agent.createdBy nulled (SetNull)');

    // Audit retained, link nulled, IP scrubbed.
    const auditAfter = await prisma.aiAdminAuditLog.findUnique({ where: { id: audit.id } });
    check(auditAfter !== null, 'audit row retained');
    check(auditAfter?.userId === null, 'audit.userId nulled (SetNull)');
    check(auditAfter?.clientIp === null, 'audit.clientIp scrubbed (residual PII)');

    // Evaluations: dataset retained + de-attributed; run cascade-deleted.
    const datasetAfter = await prisma.aiDataset.findUnique({ where: { id: dataset.id } });
    check(datasetAfter !== null, 'eval dataset retained');
    check(datasetAfter?.userId === null, 'eval dataset.userId nulled (SetNull)');
    check(
      (await prisma.aiEvaluationRun.findUnique({ where: { id: run.id } })) === null,
      'eval run cascade-deleted'
    );

    // System-owned inbound data survives — the erasure is bounded to the
    // subject. A regression here means an operator leaving the company takes
    // the customer correspondence with them.
    const inboundConvAfter = await prisma.aiConversation.findUnique({
      where: { id: inboundConversation.id },
    });
    check(inboundConvAfter !== null, 'third party’s inbound conversation survives the erasure');
    check(
      (await prisma.aiMessage.findUnique({ where: { id: inboundMessage.id } })) !== null,
      'third party’s inbound message survives the erasure'
    );
    check(
      (await prisma.aiWorkflowExecution.findUnique({ where: { id: inboundExecution.id } })) !==
        null,
      'inbound-triggered run survives the erasure'
    );

    // Receipt written without re-introducing PII.
    const receipt = await prisma.dataErasureReceipt.findUnique({ where: { id: result.receiptId } });
    check(receipt !== null, 'erasure receipt written');
    check(receipt?.subjectUserId === subject.id, 'receipt subjectUserId matches');
    check(
      typeof receipt?.subjectEmailHash === 'string' && receipt.subjectEmailHash.length === 64,
      'receipt stores a 64-char sha256 email hash, not the raw email'
    );
    check(receipt?.reason === 'self_service', 'receipt records the reason');

    console.log('\n✓ smoke:erasure passed');
  } finally {
    // Self-clean by tracked id. The user + its cascade children may already be
    // gone (erased); deleteMany is a no-op then. All FKs here are Cascade/SetNull,
    // so order can't cause constraint violations.
    if (receiptId)
      await prisma.dataErasureReceipt
        .deleteMany({ where: { id: receiptId } })
        .catch(() => undefined);
    if (auditId)
      await prisma.aiAdminAuditLog.deleteMany({ where: { id: auditId } }).catch(() => undefined);
    if (slotValueId)
      await prisma.slotValue.deleteMany({ where: { id: slotValueId } }).catch(() => undefined);
    // Journey children before the journey (events' journeyId is SetNull, node states
    // Cascade — order is safe either way; explicit for clarity on the non-erased path).
    if (journeyEventLinkedId)
      await prisma.journeyEvent
        .deleteMany({ where: { id: journeyEventLinkedId } })
        .catch(() => undefined);
    if (journeyEventEngagementId)
      await prisma.journeyEvent
        .deleteMany({ where: { id: journeyEventEngagementId } })
        .catch(() => undefined);
    if (nodeStateId)
      await prisma.userNodeState.deleteMany({ where: { id: nodeStateId } }).catch(() => undefined);
    if (journeyId)
      await prisma.userJourney.deleteMany({ where: { id: journeyId } }).catch(() => undefined);
    if (subjectUserId)
      await prisma.user.deleteMany({ where: { id: subjectUserId } }).catch(() => undefined);
    if (runId)
      await prisma.aiEvaluationRun.deleteMany({ where: { id: runId } }).catch(() => undefined);
    if (datasetId)
      await prisma.aiDataset.deleteMany({ where: { id: datasetId } }).catch(() => undefined);
    if (inboundExecutionId)
      await prisma.aiWorkflowExecution
        .deleteMany({ where: { id: inboundExecutionId } })
        .catch(() => undefined);
    if (workflowId)
      await prisma.aiWorkflow.deleteMany({ where: { id: workflowId } }).catch(() => undefined);
    // Deleted before the agent: the conversation is Cascade off `agentId`, so
    // removing the agent first would take it (and its messages) with it — fine
    // for cleanup, but explicit beats incidental.
    if (inboundConversationId)
      await prisma.aiConversation
        .deleteMany({ where: { id: inboundConversationId } })
        .catch(() => undefined);
    if (agentId) await prisma.aiAgent.deleteMany({ where: { id: agentId } }).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch(async (err) => {
  console.error('\n✗ smoke:erasure failed:', err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
