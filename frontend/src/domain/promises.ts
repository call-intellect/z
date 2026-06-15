/**
 * Редизайн Ф7б — доменная модель «открытого вопроса» для вкладки
 * «Мои обещания» (`/me?tab=promises`).
 *
 * Слой DomainModel: ApiDto → нормализованная сущность (Date вместо ISO-строки,
 * нейтральные имена полей `meetingId` / `meetingTitle`).
 *
 * Открытый вопрос — это НЕ обещание: блок-обещание, которому не хватает данных
 * до полноценного обещания (нет автора / нет ответственного и срока). Поэтому
 * он показывается отдельной секцией и не считается «обещанием человека».
 *
 * Полные обещания (`items`) по-прежнему рендерятся напрямую из `CommitmentApi`
 * (исторически без доменного слоя) — ломать совместимость не нужно.
 */

import type { OpenQuestionApi } from '@/api/promises.api';

export interface OpenQuestion {
  id: string;
  text: string;
  /** id встречи-источника; null если вопрос не из встречи. */
  meetingId: string | null;
  /** Заголовок встречи-источника; null если не найден. */
  meetingTitle: string | null;
  /** Чего не хватает до полного обещания (человекочитаемо, RU). */
  reason: string;
  createdAt: Date;
}

export function openQuestionFromApi(dto: OpenQuestionApi): OpenQuestion {
  return {
    id: dto.id,
    text: dto.text,
    meetingId: dto.sourceMeetingId,
    meetingTitle: dto.sourceMeetingTitle,
    reason: dto.reason,
    createdAt: new Date(dto.createdAt),
  };
}
