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
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
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
import { KnowledgeAccessLoggerInterceptor } from './interceptors/knowledge-access-logger.interceptor';
import { PersonPulseService, type PersonPulseDto } from './services/person-pulse.service';
import { PersonsService } from './services/persons.service';

@ApiTags('persons')
@Controller('api/v1/persons')
@UseGuards(CookieAuthGuard, TenantGuard)
@UseInterceptors(KnowledgeAccessLoggerInterceptor)
export class PersonsController {
  constructor(
    @Inject(PersonsService) private readonly persons: PersonsService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(PersonPulseService) private readonly personPulseSvc: PersonPulseService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
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

  @Get(':id/pulse')
  @ApiOperation({ summary: 'Pulse-карточка сотрудника (engagement / mood / promises / HR)' })
  async pulse(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PersonPulseDto> {
    const t = this.requireTenant(tenantId);
    const allowed = await this.canViewPulse(user.id, t, id);
    if (!allowed) {
      throw this.forbidden('Нет доступа к карточке сотрудника');
    }
    const isSelf = await this.isSelfPerson(user.id, t, id);
    return this.personPulseSvc.getPulse({
      tenantId: t,
      personId: id,
      forSelf: isSelf,
    });
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
    summary: 'Быстро создать внешний контакт (Calendar MVP) — минимально name+email?+phone?',
    description:
      'Используется ParticipantPicker в EventForm. Дубль-защита по (tenantId, email): если контакт с этим email уже существует, возвращается существующий. Без email — поиск по точному совпадению name среди контактов без email.',
  })
  async quickCreate(
    @Body(new ZodValidationPipe(QuickCreatePersonSchema)) body: QuickCreatePersonDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<QuickCreatePersonResponseDto> {
    const t = this.requireTenant(tenantId);
    const ok = await this.rbac.canWrite(user.id, t, 'event_card');
    if (!ok) {
      throw this.forbidden('Недостаточно прав для создания контактов из календаря');
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

  private async canViewPulse(userId: string, tenantId: string, personId: string): Promise<boolean> {
    return this.rbac.canViewEmployeeFullCard({
      viewerUserId: userId,
      employeePersonId: personId,
      tenantId,
    });
  }

  private async isSelfPerson(userId: string, tenantId: string, personId: string): Promise<boolean> {
    const person = await this.prisma.person.findFirst({
      where: { id: personId, tenantId },
      select: { userId: true },
    });
    return person?.userId === userId;
  }

  private forbidden(message: string): ForbiddenException {
    return new ForbiddenException({
      ok: false,
      error: { code: 'forbidden', message },
    });
  }
}
