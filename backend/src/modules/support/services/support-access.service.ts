import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * SupportAccessService — единый источник правды о том, кто такой «сотрудник
 * поддержки» и какая Org — вендор-деск.
 *
 * Р-2 / Р-7 (ТЗ 2026-06-09 support-desk): галочка «сотрудник поддержки» =
 * членство в закрытом контуре `KnowledgeGroup(kind='support', refId=null)`
 * вендор-Org. Ноль новых моделей доступа.
 *
 * Вендор-Org читается из AdminSetting `support.vendor_org_id` (параметр
 * владельца — «решение владельца», без него деск выключен).
 *
 * Все методы fail-safe: при любой ошибке/недостающем звене → null/false
 * (не пускаем). Используется и `SupportAccessGuard`, и сервисами.
 */
@Injectable()
export class SupportAccessService {
  private readonly logger = new Logger(SupportAccessService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  /**
   * ID вендор-Org (деск приёма). Из AdminSetting `support.vendor_org_id`
   * (JSON-строка). Пусто/не задано → null (деск выключен — «решение владельца»).
   */
  async getVendorOrgId(): Promise<string | null> {
    try {
      const raw = await this.cfg.getDynamic<string>(
        'support.vendor_org_id',
        undefined,
        '',
      );
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

  /**
   * Статус поддержки для текущего пользователя — для фронта (виджет/сайдбар).
   * `deskEnabled` = флаг включён И вендор-Org задан (иначе виджет не показываем).
   * `isAgent` = член контура поддержки (сотрудник деска).
   */
  async getStatus(
    userId: string,
  ): Promise<{ deskEnabled: boolean; isAgent: boolean }> {
    const vendorOrgId = await this.getVendorOrgId();
    const deskEnabled = this.cfg.supportDesk.enabled && !!vendorOrgId;
    const isAgent = await this.isAgent(userId);
    return { deskEnabled, isAgent };
  }

  /** ID синглтон-группы контура поддержки в вендор-Org. null если нет. */
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

  /**
   * Является ли пользователь сотрудником поддержки = членом группы-контура
   * вендор-Org. Любое недостающее звено (нет вендор-Org / Person / группы /
   * членства) → false. Fail-safe (catch → false).
   */
  async isAgent(userId: string): Promise<boolean> {
    try {
      const vendorOrgId = await this.getVendorOrgId();
      if (!vendorOrgId) return false;

      // Person пользователя в вендор-Org (не мутируем).
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
