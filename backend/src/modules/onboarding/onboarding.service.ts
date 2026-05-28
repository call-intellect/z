import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

import type { WelcomePatchBody } from './dto/welcome-patch.dto';
import { humanize } from './onboarding-labels';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** PATCH /orgs/:orgId/welcome — пошаговое сохранение ответов Блока A */
  async patchWelcome(args: {
    orgId: string;
    userId: string;
    body: WelcomePatchBody;
  }): Promise<{ ok: true }> {
    const { orgId, body } = args;
    await this.assertOrgExists(orgId);

    const data: Record<string, unknown> = {};
    if (body.teamSize !== undefined) data['teamSize'] = body.teamSize;
    if (body.industry !== undefined) data['industry'] = body.industry;
    if (body.painPoints !== undefined) data['painPoints'] = body.painPoints;
    if (body.currentStack !== undefined) data['currentStack'] = body.currentStack;
    if (body.plannedFeatures !== undefined) data['plannedFeatures'] = body.plannedFeatures;

    // companyInfoCompletedAt — ставим при первом сохранении industry
    if (body.industry !== undefined) {
      data['companyInfoCompletedAt'] = new Date();
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.org.update({ where: { id: orgId }, data });
    }

    return { ok: true };
  }

  /** POST /orgs/:orgId/welcome/complete — финал Блока A: создаём документ */
  async completeWelcome(args: {
    orgId: string;
    userId: string;
  }): Promise<{ ok: true; redirectTo: string }> {
    const { orgId, userId } = args;

    const org = await this.prisma.org.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        industry: true,
        teamSize: true,
        painPoints: true,
        currentStack: true,
        plannedFeatures: true,
      },
    });
    if (!org) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'org_not_found', message: 'Org не найдена' },
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, companyRole: true },
    });
    if (!user) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'user_not_found', message: 'Пользователь не найден' },
      });
    }

    // Ищем Person-запись пользователя в этой Org
    const person = await this.prisma.person.findFirst({
      where: { tenantId: orgId, userId, deletedAt: null },
      select: { id: true },
    });

    // Создаём документ «Знакомство с компанией» только если есть Person-запись
    if (person) {
      const content = this.buildWelcomeDocument({ org, user });
      await this.prisma.document.create({
        data: {
          tenantId: orgId,
          uploaderId: person.id,
          kind: 'text',
          name: 'Знакомство с компанией',
          mimeType: 'text/plain',
          originalSize: Buffer.byteLength(content, 'utf8'),
          inlineContent: Buffer.from(content, 'utf8'),
          status: 'uploaded',
        },
      });
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.org.update({ where: { id: orgId }, data: { welcomeCompletedAt: now } }),
      this.prisma.user.update({ where: { id: userId }, data: { profileCompletedAt: now } }),
    ]);

    return { ok: true, redirectTo: '/dashboard' };
  }

  /** POST /orgs/:orgId/setup/complete — все 6 шагов Блока B пройдены/пропущены */
  async completeSetup(args: { orgId: string }): Promise<{ ok: true }> {
    await this.assertOrgExists(args.orgId);
    await this.prisma.org.update({
      where: { id: args.orgId },
      data: { setupCompletedAt: new Date() },
    });
    return { ok: true };
  }

  /** PATCH /api/v1/users/me — обновление companyRole */
  async updateCompanyRole(args: { userId: string; companyRole: string }): Promise<{ ok: true }> {
    await this.prisma.user.update({
      where: { id: args.userId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { companyRole: args.companyRole as any },
    });
    return { ok: true };
  }

  private async assertOrgExists(orgId: string): Promise<void> {
    const org = await this.prisma.org.findUnique({ where: { id: orgId }, select: { id: true } });
    if (!org) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'org_not_found', message: 'Org не найдена' },
      });
    }
  }

  private buildWelcomeDocument(args: {
    org: {
      name: string;
      industry: string | null;
      teamSize: string | null;
      painPoints: string[];
      currentStack: string[];
      plannedFeatures: string[];
    };
    user: {
      name: string;
      companyRole: string | null;
    };
  }): string {
    const { org, user } = args;
    const date = new Date().toLocaleDateString('ru-RU');
    const roleLabel = user.companyRole ? humanize(user.companyRole) : 'Не указано';
    const industryLabel = org.industry ? humanize(org.industry) : 'Не указано';

    const painList =
      org.painPoints.map((p) => `- ${humanize(p)}`).join('\n') || '- Не указано';
    const stackList =
      org.currentStack.map((s) => `- ${humanize(s)}`).join('\n') || '- Не указано';
    const featureList =
      org.plannedFeatures.map((f) => `- ${humanize(f)}`).join('\n') || '- Не указано';

    return `Компания: ${org.name}
Сфера: ${industryLabel}
Размер: ${org.teamSize ?? 'Не указано'}

Заполнил: ${user.name} (${roleLabel}), ${date}

Главные боли:
${painList}

Сейчас работают на:
${stackList}

Главный интерес в Коре:
${featureList}
`;
  }
}
