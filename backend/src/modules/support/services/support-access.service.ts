import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class SupportAccessService {
  private readonly logger = new Logger(SupportAccessService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async getVendorOrgId(): Promise<string | null> {
    try {
      const raw = await this.cfg.getDynamic<string>('support.vendor_org_id', undefined, '');
      const id = typeof raw === 'string' ? raw.trim() : '';
      return id.length > 0 ? id : null;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'getVendorOrgId: чтение AdminSetting support.vendor_org_id упало — деск выключен',
      );
      return null;
    }
  }

  async getStatus(userId: string): Promise<{ deskEnabled: boolean; isAgent: boolean }> {
    const vendorOrgId = await this.getVendorOrgId();
    const deskEnabled = this.cfg.supportDesk.enabled && !!vendorOrgId;
    const isAgent = await this.isAgent(userId);
    return { deskEnabled, isAgent };
  }

  async getSupportGroupId(vendorOrgId: string): Promise<string | null> {
    try {
      const group = await this.prisma.knowledgeGroup.findFirst({
        where: { tenantId: vendorOrgId, kind: 'support', refId: null },
        select: { id: true },
      });
      return group?.id ?? null;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'getSupportGroupId: запрос группы контура упал',
      );
      return null;
    }
  }

  async isAgent(userId: string): Promise<boolean> {
    try {
      const vendorOrgId = await this.getVendorOrgId();
      if (!vendorOrgId) return false;

      const person = await this.prisma.person.findFirst({
        where: { tenantId: vendorOrgId, userId, deletedAt: null },
        select: { id: true },
      });
      if (!person) return false;

      const groupId = await this.getSupportGroupId(vendorOrgId);
      if (!groupId) return false;

      const member = await this.prisma.knowledgeGroupMember.findUnique({
        where: { groupId_personId: { groupId, personId: person.id } },
        select: { personId: true },
      });
      return !!member;
    } catch (err) {
      this.logger.warn(
        { userId, err: err instanceof Error ? err.message : String(err) },
        'isAgent: проверка членства упала — отказываем (fail-safe)',
      );
      return false;
    }
  }
}
