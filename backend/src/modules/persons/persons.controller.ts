import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  BatchCreatePersonsSchema,
  CreatePersonSchema,
  ListPersonsQuerySchema,
  QuickCreatePersonSchema,
  UpdatePersonSchema,
  type BatchCreatePersonsDto,
  type CreatePersonDto,
  type ListPersonsQuery,
  type PersonDto,
  type PersonListItemDto,
  type QuickCreatePersonDto,
  type QuickCreatePersonResponseDto,
  type UpdatePersonDto,
} from './dto/persons.dto';
import { PersonsService } from './services/persons.service';

/**
 * REST API сотрудников (Person) — Фаза 0a, группа А.
 *
 *   GET    /api/v1/persons?q=&departmentId=&roleId=&invitationStatus=
 *   GET    /api/v1/persons/:id
 *   POST   /api/v1/persons
 *   POST   /api/v1/persons/batch
 *   PATCH  /api/v1/persons/:id
 *   DELETE /api/v1/persons/:id
 *
 * RBAC ресурс — `person`. owner/admin — read/write/delete. manager — read.
 *
 * Не путать с `/api/v1/knowledge/entities?type=person` — то knowledge-core,
 * этот модуль — ЛК Org (структура компании клиента).
 */
@ApiTags('persons')
@Controller('api/v1/persons')
@UseGuards(CookieAuthGuard, TenantGuard)
export class PersonsController {
  constructor(
    @Inject(PersonsService) private readonly persons: PersonsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список сотрудников Org' })
  async list(
    @Query(new ZodValidationPipe(ListPersonsQuerySchema)) q: ListPersonsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: PersonListItemDto[]; total: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.persons.list({
      tenantId: t,
      q: q.q,
      departmentId: q.departmentId,
      roleId: q.roleId,
      invitationStatus: q.invitationStatus,
      includeDeleted: q.includeDeleted,
      limit: q.limit,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить сотрудника по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PersonDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.persons.get({ tenantId: t, id });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать сотрудника (userId=null до accept приглашения)' })
  async create(
    @Body(new ZodValidationPipe(CreatePersonSchema)) body: CreatePersonDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PersonDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.persons.create({ tenantId: t, userId: user.id, body });
  }

  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Массово создать сотрудников (пропускает дубли по email)' })
  async createBatch(
    @Body(new ZodValidationPipe(BatchCreatePersonsSchema))
    body: BatchCreatePersonsDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: PersonDto[]; created: number; skipped: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.persons.createBatch({ tenantId: t, userId: user.id, body });
  }

  @Post('quick-create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Быстро создать внешний контакт (Calendar MVP) — минимально name+email?+phone?',
    description:
      'Используется ParticipantPicker в EventForm. Дубль-защита по (tenantId, email): если контакт с этим email уже существует, возвращается существующий. Без email — поиск по точному совпадению name среди контактов без email.',
  })
  async quickCreate(
    @Body(new ZodValidationPipe(QuickCreatePersonSchema)) body: QuickCreatePersonDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<QuickCreatePersonResponseDto> {
    const t = this.requireTenant(tenantId);
    // RBAC: write по event_card (раз создаём при создании события). Если нет
    // прав на события — запрещаем; managers без write по event_card не должны
    // плодить контакты.
    const ok = await this.rbac.canWrite(user.id, t, 'event_card');
    if (!ok) {
      throw this.forbidden(
        'Недостаточно прав для создания контактов из календаря',
      );
    }
    return this.persons.quickCreate({ tenantId: t, userId: user.id, body });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить сотрудника (смена должности закрывает старую)' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePersonSchema)) body: UpdatePersonDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PersonDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.persons.update({ tenantId: t, userId: user.id, id, body });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить сотрудника (soft-delete, закрывает все связи)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ id: string; deletedAt: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.persons.softDelete({ tenantId: t, userId: user.id, id });
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'person');
    if (!ok) throw this.forbidden('Недостаточно прав для чтения сотрудников');
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'person');
    if (!ok) throw this.forbidden('Изменять сотрудников может только владелец/администратор Org');
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'person',
      act: 'delete',
    });
    if (!ok) throw this.forbidden('Удалять сотрудников может только владелец/администратор Org');
  }

  private forbidden(message: string): ForbiddenException {
    return new ForbiddenException({
      ok: false,
      error: { code: 'forbidden', message },
    });
  }
}
