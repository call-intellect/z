---
name: nestjs-rules
description: Стандарты NestJS backend-разработки Z: DTO-цепочки, FiltersDto, Swagger, транзакции через Prisma, логирование, события. Используй этот скилл при создании или рефакторинге ЛЮБОГО backend-кода — модулей, сервисов, контроллеров, DTO, guards, фильтров. Обязателен при добавлении нового эндпоинта или изменении существующего API.
---

# Z: стандарты NestJS backend

## DTO-цепочки

Каждый ресурс имеет иерархию DTO. Не создавай монолитные DTO — разделяй по назначению.

```typescript
// Базовый — общие поля
export class BaseMeetingDto {
  @IsString()
  title: string;

  @IsEnum(MeetingType)
  type: MeetingType;
}

// Создание
export class CreateMeetingDto extends BaseMeetingDto {
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}

// Обновление (все поля опциональные)
export class UpdateMeetingDto extends PartialType(BaseMeetingDto) {}

// Ответ (включает служебные поля)
export class MeetingResponseDto extends BaseMeetingDto {
  id: string;
  status: MeetingStatus;
  hostId: string;
  createdAt: Date;
  updatedAt: Date;
}
```

## FiltersDto для пагинации и поиска

```typescript
export class MeetingsFiltersDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(MeetingStatus)
  status?: MeetingStatus;
}
```

Всегда возвращай метаданные пагинации:

```typescript
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

---

## Контроллеры — только роутинг

Контроллер не содержит бизнес-логику. Только:
- Декораторы роутинга и Swagger
- Валидация входящих DTO (через `ValidationPipe`)
- Вызов сервиса
- Возврат результата

```typescript
@Controller('meetings')
@UseGuards(JwtAuthGuard)
@ApiTags('meetings')
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Post()
  @ApiOperation({ summary: 'Create meeting' })
  @ApiResponse({ type: MeetingResponseDto })
  create(
    @Body() dto: CreateMeetingDto,
    @CurrentUser() user: AuthUser,
  ): Promise<MeetingResponseDto> {
    return this.meetingsService.create(dto, user.id);
  }
}
```

---

## Swagger декораторы

Каждый публичный эндпоинт должен иметь:

```typescript
@ApiOperation({ summary: 'Краткое описание' })
@ApiResponse({ status: 200, type: ResponseDto })
@ApiResponse({ status: 400, description: 'Validation error' })
@ApiResponse({ status: 403, description: 'Forbidden' })
```

DTO-классы должны иметь `@ApiProperty()` на каждом поле.

---

## Сервисы — бизнес-логика

Сервис содержит всю бизнес-логику. Правила:

- Один публичный метод = одна операция
- Проверяй ownership перед любой мутацией
- Кидай HTTP-исключения через `HttpException` / `NotFoundException` / `ForbiddenException`
- Не возвращай Prisma-модели напрямую — маппи в ResponseDto

```typescript
async findById(id: string, userId: string): Promise<MeetingResponseDto> {
  const meeting = await this.prisma.meeting.findUnique({ where: { id } });

  if (!meeting) throw new NotFoundException('Meeting not found');
  if (meeting.hostId !== userId) throw new ForbiddenException();

  return this.toResponseDto(meeting);
}
```

---

## Транзакции через Prisma

Операции, затрагивающие несколько таблиц — всегда в транзакции:

```typescript
await this.prisma.$transaction(async (tx) => {
  const meeting = await tx.meeting.create({ data: { ... } });
  await tx.participant.create({ data: { meetingId: meeting.id, ... } });
  await tx.activityLog.create({ data: { ... } });
});
```

Не используй несколько последовательных `this.prisma.*` без транзакции там, где нужна атомарность.

---

## Логирование

Через `Logger` из NestJS (или `SystemLoggerService`):

```typescript
private readonly logger = new Logger(MeetingsService.name);

async create(dto: CreateMeetingDto): Promise<MeetingResponseDto> {
  this.logger.log(`Creating meeting type=${dto.type}`);
  try {
    // ...
  } catch (error) {
    this.logger.error('Failed to create meeting', error.stack);
    throw error;
  }
}
```

Логируй: старт критических операций, ошибки с stack trace, бизнес-события.

---

## События через EventEmitter2

Не вызывай side effects напрямую из сервиса. Испускай события:

```typescript
this.eventEmitter.emit('meeting.created', {
  meetingId: meeting.id,
  hostId: meeting.hostId,
});
```

Подписчики (listeners) обрабатывают нотификации, AI-обработку, аналитику.

---

## LiveKit — только медиа, токены — на бэке

- Токены LiveKit (host / guest) генерирует **только** backend через LiveKit Server SDK.
- Frontend не получает API key / secret LiveKit ни при каких условиях.
- Гость по `/g/:token` обращается к нашему backend, backend проверяет guest_token и возвращает короткоживущий LiveKit access token.
- Никакой бизнес-логики (статусы встреч, права, billing) внутри LiveKit Server — он только media routing.

---

## AI-задачи — только через очередь (BullMQ / Redis)

Никакого синхронного вызова AI из HTTP-хендлера. Только очередь:

```typescript
// Правильно — добавить в очередь
await this.aiQueue.add('process-meeting', { meetingId }, { attempts: 3 });

// Неправильно — прямой вызов из сервиса
const result = await this.llmClient.complete({ ... }); // ← ЗАПРЕЩЕНО в HTTP-цикле
```

---

## Лимиты по тарифам

Всегда через `plan-limits` (когда модуль появится), никогда хардкодом:

```typescript
// Правильно
const limit = await this.planLimits.get(userId, 'meetings_per_month');
if (currentCount >= limit) throw new ForbiddenException('Plan limit reached');

// Неправильно
if (currentCount >= 10) throw new ForbiddenException(); // ← ЗАПРЕЩЕНО
```

---

## Чеклист нового модуля

- [ ] DTO-цепочка: Base → Create → Update → Response
- [ ] FiltersDto с пагинацией
- [ ] Контроллер — только роутинг, без логики
- [ ] Swagger-декораторы на всех эндпоинтах
- [ ] Ownership-проверка в сервисе
- [ ] Транзакции там, где нужна атомарность
- [ ] Логирование критических операций
- [ ] События вместо прямых side effects
- [ ] AI через очередь, не синхронно
- [ ] Лимиты через plan-limits
- [ ] LiveKit-токены не утекают на фронт
