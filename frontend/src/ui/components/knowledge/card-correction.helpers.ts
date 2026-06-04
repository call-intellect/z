/**
 * Чистые хелперы для CardCorrectionActions (Фаза E2, лестница доверия).
 *
 * Вынесены отдельно от компонента, чтобы покрыть unit-тестами без рендера
 * (см. card-correction.helpers.spec.ts). Логика подписей/тостов/диффа
 * не должна зависеть от React.
 */

/**
 * Подпись кнопки подтверждения в диалоге «Исправить».
 *  - owner/admin (canApplyDirectly=true) → правка применяется сразу, карточка
 *    становится человеко-проверенной.
 *  - остальные → правка уходит куратору предложением.
 */
export function correctConfirmLabel(canApplyDirectly: boolean): string {
  return canApplyDirectly
    ? 'Сохранить как проверенную версию'
    : 'Предложить правку';
}

/**
 * Текст success-тоста после успешного `correct`.
 *  - applied=true  → правка применена мгновенно.
 *  - applied=false → правка ушла куратору на проверку.
 */
export function correctSuccessMessage(applied: boolean): string {
  return applied
    ? 'Карточка обновлена — теперь она проверена человеком'
    : 'Правка отправлена куратору на проверку';
}

/**
 * Отбирает только реально изменённые поля.
 *
 * Поле попадает в результат, если:
 *   - оно присутствует в `current`, И
 *   - его значение (после trim по краям) отличается от исходного value
 *     (тоже trim по краям).
 *
 * В результат кладём НЕтримленное значение `current[key]` — тримминг нужен
 * только для сравнения, чтобы «  текст » == «текст» не считались правкой,
 * но при реальной правке пользователь получает то, что ввёл.
 */
export function pickChangedFields(
  fields: { key: string; value: string }[],
  current: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of fields) {
    if (!(field.key in current)) continue;
    const next = current[field.key];
    if (next === undefined) continue;
    if (next.trim() === field.value.trim()) continue;
    result[field.key] = next;
  }
  return result;
}
