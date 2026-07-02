import { PrismaService } from '../../../common/prisma/prisma.service';

const CYCLE_GUARD_MAX_DEPTH = 50;

export async function wouldCreateCycle(
  prisma: Pick<PrismaService, 'goal'>,
  tenantId: string,
  goalId: string,
  newParentId: string,
): Promise<boolean> {
  if (newParentId === goalId) return true;
  let cursor: string | null = newParentId;
  let depth = 0;
  while (cursor && depth < CYCLE_GUARD_MAX_DEPTH) {
    if (cursor === goalId) return true;
    const node: { parentGoalId: string | null } | null = await prisma.goal.findFirst({
      where: { id: cursor, tenantId },
      select: { parentGoalId: true },
    });
    cursor = node?.parentGoalId ?? null;
    depth += 1;
  }
  return false;
}
