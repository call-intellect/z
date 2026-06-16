import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { ExecutablePersonaBuildService } from './executable-persona-build.service';

/**
 * Clones=Roles Ф2 (2026-05-25) — payload события «у должности сменился носитель».
 *
 * Эмитится из `AppointmentsService` / `PersonsService` при переходе Person.A
 * (старый носитель) → Person.B (новый носитель). Если эмиттер не знает старого
 * носителя — `oldPersonId=null` (например, первое назначение на роль).
 *
 * Контракт по полям:
 *   - `tenantId`            — Org, в которой произошло событие.
 *   - `roleId`              — Role.id (должность).
 *   - `oldPersonId`         — Person.id, кто прекратил занимать роль; null если
 *                              никто ранее не занимал.
 *   - `newPersonId`         — Person.id, кто начал занимать роль; null если
 *                              роль освободилась (приостановка клона).
 *   - `changedAt`           — момент смены (для метрики lag).
 */
export interface RoleBearerChangedEvent {
  tenantId: string;
  roleId: string;
  oldPersonId: string | null;
  newPersonId: string | null;
  changedAt: Date;
}

/**
 * Clones=Roles Ф2 + Раздел 7 (2026-06-16) — обработчик `role.bearer_changed`.
 *
 * Модель «один человек = один клон должности»:
 *   - Новый носитель (newPersonId≠null): `ExecutablePersonaBuildService.buildForRole`
 *     атомарно замораживает прошлую active (→`frozen`, read-only, остаётся доступной)
 *     и создаёт новую active vN+1 из профиля нового носителя. Версионные поля —
 *     по построению (закрывает Б12/Б16/Б17). Промежуточный `pending_rebuild`-стаб
 *     БОЛЬШЕ НЕ создаётся (устраняет Б17-зазор «нет active до build» и Б18-дубли).
 *   - Роль освободилась (newPersonId=null): текущую active замораживаем
 *     (→`frozen`), новый клон не строим. Клон ушедшего остаётся доступен навсегда.
 *
 * Идемпотентность: если active уже указывает на newPersonId — skip.
 *
 * Failure-mode: всё в try/catch + warn-лог. Если у нового носителя мало traits и
 * build вернул null — прошлая active остаётся доступной, следующий cron доберёт.
 */
@Injectable()
export class RoleClonePersonaVersioningHandler {
  private readonly logger = new Logger(RoleClonePersonaVersioningHandler.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ExecutablePersonaBuildService)
    private readonly builder: ExecutablePersonaBuildService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  @OnEvent('role.bearer_changed', { async: true })
  async onBearerChanged(event: RoleBearerChangedEvent): Promise<void> {
    try {
      await this.handle(event);
    } catch (err) {
      this.logger.warn(
        {
          roleId: event.roleId,
          tenantId: event.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'role.bearer_changed: handler упал — skip (cron доберёт)',
      );
    }
  }

  /**
   * Публичная для прямого вызова из тестов / admin force-new-version API.
   * Возвращает id новой персоны или null если skip (идемпотентность / role не найден).
   */
  async handle(event: RoleBearerChangedEvent): Promise<string | null> {
    // Проверяем существование Role (защита от устаревших событий).
    const role = await this.prisma.role.findUnique({
      where: { id: event.roleId },
      select: { id: true, name: true, tenantId: true, deletedAt: true },
    });
    if (!role || role.deletedAt || role.tenantId !== event.tenantId) {
      this.logger.debug(
        { roleId: event.roleId },
        'role.bearer_changed: Role не найден / удалён / иной tenant — skip',
      );
      return null;
    }

    // Текущая активная версия клона роли (если есть).
    const prevActive = await this.prisma.executablePersona.findFirst({
      where: {
        tenantId: event.tenantId,
        scope: 'role',
        scopeRefId: event.roleId,
        status: 'active',
      },
      orderBy: [{ roleVersion: 'desc' }, { snapshotAt: 'desc' }],
      select: { id: true, currentBearerPersonId: true },
    });

    // Идемпотентность: active уже указывает на newPersonId — эмиттер дёрнул впустую.
    if (
      prevActive &&
      event.newPersonId !== null &&
      prevActive.currentBearerPersonId === event.newPersonId
    ) {
      this.logger.debug(
        { roleId: event.roleId, newPersonId: event.newPersonId },
        'role.bearer_changed: active persona уже указывает на newPersonId — skip',
      );
      return null;
    }

    // Раздел 7 (Р3/Р5) — роль освободилась (носитель ушёл, замены нет):
    // замораживаем текущую active (frozen, read-only — клон ушедшего остаётся
    // доступным для вопросов навсегда), новый клон НЕ строим (не из кого).
    // Промежуточный pending_rebuild-стаб не создаём (устраняет Б17/Б18).
    if (event.newPersonId === null) {
      if (prevActive) {
        await this.prisma.executablePersona.updateMany({
          where: { id: prevActive.id, status: 'active' },
          data: { status: 'frozen' },
        });
        this.logger.log(
          {
            roleId: event.roleId,
            roleName: role.name,
            frozenPersonaId: prevActive.id,
          },
          'role.bearer_changed: роль освободилась — текущий клон заморожен (frozen, остаётся доступным)',
        );
      }
      return prevActive?.id ?? null;
    }

    // Раздел 7 (Р1/Р3) — новый носитель: buildForRole атомарно заморозит прошлую
    // active и создаст новую active vN+1 из профиля нового носителя (версионные
    // поля — по построению). Если у нового носителя мало traits, build вернёт null
    // и прошлая active останется доступной («пропажи клона» нет); weekly cron доберёт.
    const built = await this.builder.buildForRole({
      tenantId: event.tenantId,
      roleId: event.roleId,
      bearerPersonId: event.newPersonId,
      triggerReason: 'on_demand',
      triggerEventAt: event.changedAt,
    });
    if (built) {
      this.metrics?.incCloneRoleVersionCreated({ roleId: event.roleId });
      this.logger.log(
        {
          roleId: event.roleId,
          roleName: role.name,
          oldPersonId: event.oldPersonId,
          newPersonId: event.newPersonId,
          personaId: built.id,
          roleVersion: built.roleVersion,
        },
        'role.bearer_changed: создана новая active-версия клона роли',
      );
    } else {
      this.logger.debug(
        { roleId: event.roleId, newPersonId: event.newPersonId },
        'role.bearer_changed: buildForRole вернул null (мало traits) — прошлый клон остаётся доступным, cron доберёт',
      );
    }
    return built?.id ?? null;
  }

  /**
   * Update gauge `clones_role_versions_total{role_id}` (общее число версий
   * на роль). Вызывается из ClonesService.getCloneHistory (после count).
   */
  // оставлено для будущего; основные счётчики идут через metrics в момент create.
   
  private _placeholder(_p: Prisma.ExecutablePersonaWhereInput): void {}
}
