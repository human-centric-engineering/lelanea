/**
 * The Discovery Questions — the Caller's Answers
 *
 * GET  /api/v1/app/onboarding/discovery — the caller's current set, their
 *      answers to it, what they skipped, and the question they resume at.
 * POST /api/v1/app/onboarding/discovery — one of:
 *      `{ "action": "answer", "questionId": "q07", "answer": "…", "branch"?: "yes" | "no" }`
 *      `{ "action": "skip", "questionId": "q07" }`
 *      `{ "action": "leave" }`
 *
 * The web shell renders the questions server-side (`app/(lelanea)/app/page.tsx`
 * and Onboarding's module page) and posts here. The rules are in
 * `lib/app/onboarding/discovery.ts`.
 *
 * - **An answer** is written as the value of the question's slot, a new
 *   version each time (`appendSlotValue`), with the onboarding module's
 *   provenance. It must be to a question in the caller's **current** set: one
 *   the Core Set leaves out, or that does not exist, is refused. `branch` is
 *   required on a question that branches and refused on one that does not.
 *   An empty answer is refused: a question left for now is skipped instead.
 * - **A skip** leaves the question unanswered. A core question cannot be
 *   skipped (owner ruling, 25 Sept 2026).
 * - **Leave** ends the first sitting.
 *
 * A skip or leave that could not be recorded (no journey yet) is a `200` with
 * `recorded: false`, as the first run's beats are: the shell's next entry
 * starts the journey, and the skipped question is offered again then. An
 * answer that could not be written is an error, because it is the person's
 * words.
 *
 * Authentication: `withAuth`. The POST refuses an API key, as the first run's
 * does: these are a person's own answers, which a key cannot give.
 *
 * Rate limiting: inherited from the `/api/v1/**` section cap.
 */

import type { NextRequest } from 'next/server';
import { withAuth, type AuthSession, type WithAuthOptions } from '@/lib/auth/guards';
import { isApiKeySession } from '@/lib/auth/api-keys';
import { successResponse } from '@/lib/api/responses';
import { ForbiddenError, ValidationError, handleAPIError } from '@/lib/api/errors';
import { validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { discoveryActionSchema } from '@/lib/app/onboarding/discovery';
import { getDiscoverySet } from '@/lib/app/onboarding/discovery-slots';
import {
  answerDiscoveryQuestion,
  getDiscoveryState,
  leaveDiscovery,
  skipDiscoveryQuestion,
} from '@/lib/app/onboarding/discovery-store';

const OWNERSHIP: WithAuthOptions = {
  ownership: {
    decidedBy: 'self',
    because:
      "Every read and write is keyed on the caller's own id — answers are the caller's own slot values, skips are on the caller's own journey. Nothing here names another subject.",
  },
};

export const GET = withAuth(async (request: NextRequest, session: AuthSession) => {
  const log = await getRouteLogger(request);
  try {
    const state = await getDiscoveryState(session.user.id);
    if (state === null) throw new Error('Discovery state could not be read');
    log.info('Discovery state read', {
      userId: session.user.id,
      next: state.position.next,
      finished: state.position.finished,
    });
    return successResponse(state);
  } catch (error) {
    return handleAPIError(error);
  }
}, OWNERSHIP);

export const POST = withAuth(async (request: NextRequest, session: AuthSession) => {
  const log = await getRouteLogger(request);
  const userId = session.user.id;
  try {
    if (isApiKeySession(session)) {
      throw new ForbiddenError('Only a signed-in person can answer the discovery questions.');
    }
    const body = await validateRequestBody(request, discoveryActionSchema);

    if (body.action === 'leave') {
      const outcome = await leaveDiscovery(userId);
      log.info('Discovery left for now', { userId, outcome });
      return successResponse({ action: body.action, recorded: outcome === 'recorded' });
    }

    const set = await getDiscoverySet();
    const question = set.questions.find((q) => q.id === body.questionId);
    if (!question) {
      throw new ValidationError('That question is not in your current set.', {
        questionId: ['Not a question in your current set'],
      });
    }

    if (body.action === 'skip') {
      if (question.core) {
        throw new ValidationError('This question is always asked, so it cannot be skipped.', {
          questionId: ['A core question cannot be skipped'],
        });
      }
      const outcome = await skipDiscoveryQuestion(userId, question.id);
      log.info('Discovery question skipped', { userId, questionId: question.id, outcome });
      return successResponse({
        action: body.action,
        questionId: question.id,
        recorded: outcome === 'recorded',
      });
    }

    const branches = question.conditionalFollowUp !== undefined;
    if (branches && body.branch === undefined) {
      throw new ValidationError('Answer yes or no first.', {
        branch: ['This question asks yes or no first'],
      });
    }
    if (!branches && body.branch !== undefined) {
      throw new ValidationError('This question does not ask yes or no.', {
        branch: ['Not asked on this question'],
      });
    }
    const outcome = await answerDiscoveryQuestion(userId, set, question, {
      words: body.answer,
      ...(body.branch !== undefined && { branch: body.branch }),
    });
    // The words themselves are never logged.
    log.info('Discovery question answered', { userId, questionId: question.id, outcome });
    return successResponse({ action: body.action, questionId: question.id, outcome });
  } catch (error) {
    return handleAPIError(error);
  }
}, OWNERSHIP);
