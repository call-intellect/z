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
 * Clones=Roles Ф2 — обработчик `role.bearer_changed`.
 *
 * Задача:
 *   1. Найти текущую `ExecutablePersona(scope='role', scopeRefId=roleId,
 *      status='active')`. Если есть — пометить `superseded`.
 *   2. Создать новую `ExecutablePersona(roleVersion=prev+1, succeedsPersonaId=prev.id,
 *      currentBearerPersonId=newPersonId, publicName='Клон <Role.name> v<N+1>',
 *      status='pending_rebuild')` с пустым `personaPrompt` (rebuild дозаполнит).
 *   3. Запросить немедленную пересборку через `ExecutablePersonaBuildService.buildForRole`
 *      (bypass idempotency-lock — это singleton-event, не шквал).
 *
 * Идемпотентность: если уже существует `ExecutablePersona(scope='role',
 * scopeRefId=roleId, status='pending_rebuild', currentBearerPersonId=newPersonId)`
 * с тем же `succeedsPersonaId`, новую запись НЕ создаём (повторный эмит того
 * же события не должен плодить версии).
 *
 * Failure-mode: всё в try/catch + warn-лог. Сбой rebuild'а оставляет персону
 * в `pending_rebuild` — следующая итерация cron'а её доберёт.
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
      select: {
        id: true,
        roleVersion: true,
        version: true,
        currentBearerPersonId: true,
      },
    });

    // Идемпотентность 1: если активная уже указывает на newPersonId — ничего не делаем
    // (это «то же самое» состояние, эмиттер дёрнул нас впустую).
    if (
      prevActive &&
      prevActive.currentBearerPersonId === event.newPersonId &&
      event.newPersonId !== null
    ) {
      this.logger.debug(
        { roleId: event.roleId, newPersonId: event.newPersonId },
        'role.bearer_changed: active persona уже указывает на newPersonId — skip',
      );
      return null;
    }

    // Идемпотентность 2: если уже есть pending_rebuild для этого newPersonId,
    // которая указывает на тот же succeedsPersonaId — повторный эмит, skip.
    const existingPending = await this.prisma.executablePersona.findFirst({
      where: {
        tenantId: event.tenantId,
        scope: 'role',
        scopeRefId: event.roleId,
        status: 'pending_rebuild',
        currentBearerPersonId: event.newPersonId,
        succeedsPersonaId: prevActive?.id ?? null,
      },
      select: { id: true },
    });
    if (existingPending) {
      this.logger.debug(
        { roleId: event.roleId, personaId: existingPending.id },
        'role.bearer_changed: pending_rebuild уже есть — skip создания дубля',
      );
      return null;
    }

    // Рассчитываем roleVersion новой версии.
    const nextRoleVersion = (prevActive?.roleVersion ?? 0) + 1;
    // Также корректный «глобальный» version (старое поле, NOT NULL).
    const lastForVersion = await this.prisma.executablePersona.findFirst({
      where: {
        tenantId: event.tenantId,
        scope: 'role',
        scopeRefId: event.roleId,
      },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (lastForVersion?.version ?? 0) + 1;

    const publicName = `Клон ${role.name} v${nextRoleVersion}`;

    const newPersona = await this.prisma.$transaction(async (tx) => {
      // Архивируем текущую активную (если есть).
      if (prevActive) {
        await tx.executablePersona.updateMany({
          where: { id: prevActive.id, status: 'active' },
          data: { status: 'superseded' },
        });
      }

      // Создаём pending_rebuild. personaPrompt — заглушка минимум 50 символов
      // (compilePersonaPrompt отбраковывает короткие), rebuild перезапишет
      // содержимое и проставит status='active'.
      return tx.executablePersona.create({
        data: {
          tenantId: event.tenantId,
          profileId: null,
          scope: 'role',
          scopeRefId: event.roleId,
          version: nextVersion,
          roleVersion: nextRoleVersion,
          currentBearerPersonId: event.newPersonId,
          publicName,
          succeedsPersonaId: prevActive?.id ?? null,
          status: 'pending_rebuild',
          personaPrompt:
            'Заглушка pending_rebuild: клон роли создан при смене носителя, ' +
            'будет пересобран при ближайшем запуске executable-persona-build.',
          includedTraitIds: [],
          builtFromTraitsCount: 0,
          triggerReason: 'on_demand',
          triggerEventAt: event.changedAt,
          // Clones=Roles Ф5 — клон роли это shared-знание Org, dataClass='internal'.
          // Полный audit будет вычислен на следующем rebuild через DataClassPolicyService.
          dataClassAudit: {
            rule: 'pending-rebuild-placeholder',
            result: 'internal',
            derivedAt: event.changedAt.toISOString(),
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });

    // Метрика: создана новая версия клона роли.
    this.metrics?.incCloneRoleVersionCreated({ roleId: event.roleId });

    this.logger.log(
      {
        roleId: event.roleId,
        roleName: role.name,
        roleVersion: nextRoleVersion,
        oldPersonId: event.oldPersonId,
        newPersonId: event.newPersonId,
        personaId: newPersona.id,
      },
      'role.bearer_changed: создана новая версия клона роли (pending_rebuild)',
    );

    // Best-effort немедленная пересборка (если новый носитель назначен).
    // Если builder возвращает null (мало traits) — pending_rebuild остаётся,
    // следующий cron-проход доберёт.
    if (event.newPersonId) {
      try {
        const built = await this.builder.buildForRole({
          tenantId: event.tenantId,
          roleId: event.roleId,
          triggerReason: 'on_demand',
          triggerEventAt: event.changedAt,
        });
        if (built && built.status === 'active') {
          // builder уже сам пометил предыдущие active как superseded — наш
          // pending_rebuild тоже должен стать superseded (он промежуточный).
          await this.prisma.executablePersona.updateMany({
            where: { id: newPersona.id, status: 'pending_rebuild' },
            data: { status: 'superseded' },
          });
        }
      } catch (err) {
        this.logger.warn(
          {
            roleId: event.roleId,
            err: err instanceof Error ? err.message : String(err),
          },
          'role.bearer_changed: immediate buildForRole упал — pending_rebuild сохранён',
        );
      }
    }

    return newPersona.id;
  }

  /**
   * Update gauge `clones_role_versions_total{role_id}` (общее число версий
   * на роль). Вызывается из ClonesService.getCloneHistory (после count).
   */
  // оставлено для будущего; основные счётчики идут через metrics в момент create.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _placeholder(_p: Prisma.ExecutablePersonaWhereInput): void {}
}
