import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  ListCustomersQuerySchema,
  type CustomerDto,
  type ListCustomersQuery,
  type ListCustomersResponse,
} from './dto/customers.dto';
import { CustomersService } from './services/customers.service';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('api/v1/customers')
@UseGuards(CookieAuthGuard, TenantGuard)
export class CustomersController {
  constructor(
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список клиентов Org (с фильтрами и пагинацией)' })
  async list(
    @Query(new ZodValidationPipe(ListCustomersQuerySchema)) q: ListCustomersQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListCustomersResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.customers.list({ tenantId: t, query: q });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить клиента по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CustomerDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.customers.getById({ tenantId: t, id });
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
    const ok = await this.rbac.canRead(userId, tenantId, 'entity');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для чтения клиентов',
        },
      });
    }
  }
}
