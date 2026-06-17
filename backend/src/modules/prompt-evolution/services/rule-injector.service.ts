import { Inject, Injectable } from '@nestjs/common';
import type { PromptRule } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class RuleInjectorService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getActiveRulesForPrompt(promptKey: string, tenantId: string | null): Promise<PromptRule[]> {
    const rows = await this.prisma.promptRule.findMany({
      where: {
        promptKey,
        status: 'active',
        OR: [{ tenantId: null }, ...(tenantId ? [{ tenantId }] : [])],
      },
      orderBy: [{ tenantId: 'desc' }, { confidence: 'desc' }],
    });
    return rows;
  }
}
