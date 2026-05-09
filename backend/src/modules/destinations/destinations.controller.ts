import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import { DestinationsService } from './destinations.service';
import {
  CreateDestinationSchema,
  type CreateDestinationDto,
  UpdateDestinationSchema,
  type UpdateDestinationDto,
} from './dto/destination.dto';

@ApiTags('destinations')
@Controller('api/v1/destinations')
@UseGuards(CookieAuthGuard)
export class DestinationsController {
  constructor(@Inject(DestinationsService) private readonly svc: DestinationsService) {}

  @Get()
  @ApiOperation({ summary: 'Список destinations (без plaintext секретов)' })
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.svc.list(user.id).then((items) => ({ items }));
  }

  @Post()
  @ApiOperation({ summary: 'Создать destination' })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(CreateDestinationSchema)) dto: CreateDestinationDto,
  ) {
    return this.svc.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить destination' })
  update(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(UpdateDestinationSchema)) dto: UpdateDestinationDto,
  ) {
    return this.svc.update(id, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить destination' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.svc.delete(id, user.id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Тестовое сообщение' })
  test(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.test(id, user.id);
  }
}
