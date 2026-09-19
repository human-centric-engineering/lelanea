/**
 * Consumer Chat — Available agents
 *
 * GET /api/v1/chat/agents
 *
 * Lists agents that are publicly visible and active. Returns a minimal
 * payload — no system instructions, provider config, or internal details
 * are exposed to consumers.
 *
 * Authentication: Any authenticated user.
 */

import { withAuth } from '@/lib/auth/guards';
import { prisma } from '@/lib/db/client';
import { successResponse } from '@/lib/api/responses';
import { getRouteLogger } from '@/lib/api/context';
import { isExcludedFromConsumerChat } from '@/lib/orchestration/chat/consumer-exclusions';

export const GET = withAuth(
  async (request, session) => {
    const log = await getRouteLogger(request);

    const listed = await prisma.aiAgent.findMany({
      where: {
        isActive: true,
        visibility: 'public',
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
      },
      orderBy: { name: 'asc' },
    });
    // A fork can keep an agent off the consumer routes
    // (`lib/orchestration/chat/consumer-exclusions.ts`).
    const agents = listed.filter((agent) => !isExcludedFromConsumerChat(agent.slug));

    log.info('Consumer agents listed', { count: agents.length, userId: session.user.id });
    return successResponse({ agents });
  },
  {
    // Ownership: this route makes no ownership decision — see RouteOwnership in lib/auth/guards.ts.
    ownership: {
      decidedBy: 'nothing',
      because:
        "The consumer agent catalogue is public by construction — `visibility: 'public'` decides what is listed, and an agent row belongs to no caller.",
    },
  }
);
