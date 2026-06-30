import type { ValueRecapSlideDto } from '../dto/value-recap.dto';
import type { ValueRecapPayload } from '../services/value-recap.scoring';

export function buildValueRecapSlides(payload: ValueRecapPayload | null): ValueRecapSlideDto[] {
  if (!payload) return [];
  const r = payload.routine;
  const t = payload.team;
  const slides: ValueRecapSlideDto[] = [];

  slides.push({
    title: `Итоги месяца ${payload.periodYm}`,
    subtitle: 'Снятая рутина — собрано и оформлено автоматически',
    bullets: [
      `Встреч запротоколировано с готовым отчётом: ${r.meetingsAutoProtocoled}${fmtDelta(payload.delta?.meetingsAutoProtocoled)}`,
      `Задач извлечено: ${r.tasksExtracted}${fmtDelta(payload.delta?.tasksExtracted)}`,
      `Решений извлечено: ${r.decisionsExtracted}${fmtDelta(payload.delta?.decisionsExtracted)}`,
      `Договорённостей извлечено: ${r.commitmentsExtracted}`,
      `Статусов команды собрано: ${r.statusesCollected}`,
      `Вопросов отвечено памятью с привязкой к источнику: ${r.questionsAnsweredWithCitation}`,
      `Идей доведено до релиза: ${r.ideasShipped}`,
    ],
  });

  slides.push({
    title: 'Команда работает лучше',
    subtitle: 'Оценочные показатели — всегда со знаменателем',
    bullets: [
      `Надёжность обещаний: ${
        t.reliabilityPercent === null
          ? 'мало данных'
          : `оценка ${t.reliabilityPercent}% (знаменатель ${t.reliabilityDenominator})`
      }`,
      `Доля «ответ помог»: ${
        t.chatHelpedRatePercent === null
          ? 'мало данных'
          : `оценка ${t.chatHelpedRatePercent}% (оценили ${t.chatRated})`
      }`,
      `Идей доведено до релиза: ${t.ideasShipped}`,
    ],
  });

  if (payload.narrative && payload.narrative.trim().length > 0) {
    slides.push({
      title: 'Коротко',
      bullets: [payload.narrative.trim()],
    });
  }

  return slides;
}

function fmtDelta(v: number | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (v > 0) return ` (+${v} к прошлому месяцу)`;
  if (v < 0) return ` (${v} к прошлому месяцу)`;
  return ' (без изменений)';
}
