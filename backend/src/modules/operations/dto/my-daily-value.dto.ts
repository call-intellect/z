import type { IdeaListItemDto } from '../../ideas/dto/ideas.dto';

/**
 * ТЗ-2 Ф5 (daily-value-dashboards) — DTO для виджетов ежедневной ценности в `/me`.
 *
 * Два тонких self-scope эндпоинта (`GET /api/v1/me/ideas`, `/me/recognitions`):
 *   - «судьба моих идей» — мои идеи (как автора), переиспользует `IdeasService.listMine`;
 *   - «полученные признания» — Recognition с `toUserId = я`.
 *
 * Self-scope: только данные самого пользователя. Чужие идеи/признания не отдаём.
 * Источник правды о полях — `backend/prisma/schema.prisma` (Idea, Recognition, Person).
 */

// ────────────── Мои идеи (self) ──────────────

/**
 * Ответ `GET /api/v1/me/ideas` — судьба моих идей.
 * Прокидываем `items` из `IdeasService.listMine({ role: 'author' })` без изменений.
 */
export interface MyIdeasResponseDto {
  items: IdeaListItemDto[];
}

// ────────────── Полученные признания (self) ──────────────

/**
 * Одно полученное признание. `fromPersonName` — отображаемое имя дарителя
 * (резолвится из `Person.name` по `fromUserId`); null если от AI/системы
 * или Person-запись не найдена. `type` НЕ переводим — карту делает фронт.
 */
export interface MyRecognitionDto {
  id: string;
  type: string;
  message: string | null;
  fromPersonName: string | null;
  visibility: string;
  createdAt: string;
}

/** Ответ `GET /api/v1/me/recognitions` — мои полученные признания. */
export interface MyRecognitionsResponseDto {
  items: MyRecognitionDto[];
}
