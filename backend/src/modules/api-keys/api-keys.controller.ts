import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import { ApiKeysService } from './api-keys.service';
import { CreateApiKeySchema, type CreateApiKeyDto } from './dto/create-api-key.dto';

/**
 * Внутренние эндпоинты для управления API-ключами.
 *
 * GET    /api/v1/api-keys          — список (без plain key)
 * POST   /api/v1/api-keys          — создать (возвращает rawKey 1 раз!)
 * DELETE /api/v1/api-keys/:id      — отозвать
 */
@ApiTags('api-keys')
@Controller('api/v1/api-keys')
@UseGuards(CookieAuthGuard)
export class ApiKeysController {
  constructor(@Inject(ApiKeysService) private readonly svc: ApiKeysService) {}

  @Get()
  @ApiOperation({ summary: 'Список API-ключей юзера (без plaintext)' })
  async list(@CurrentUser() user: CurrentUserPayload): Promise<{ items: unknown[] }> {
    const items = await this.svc.list(user.id);
    return { items };
  }

  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Создать API-ключ',
    description: 'rawKey возвращается в ответе ОДИН раз. Сохраните его сразу.',
  })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(CreateApiKeySchema)) dto: CreateApiKeyDto,
  ): Promise<{ id: string; name: string; prefix: string; rawKey: string; scopes: unknown }> {
    const { apiKey, rawKey } = await this.svc.create(user.id, dto);
    return {
      id: apiKey.id,
      name: apiKey.name,
      prefix: apiKey.prefix,
      rawKey, // !! plain — отдаётся ТОЛЬКО здесь
      scopes: apiKey.scopes,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отозвать API-ключ' })
  async revoke(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.svc.revoke(id, user.id);
  }
}
