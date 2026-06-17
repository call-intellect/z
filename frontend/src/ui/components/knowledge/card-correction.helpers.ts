export function correctConfirmLabel(canApplyDirectly: boolean): string {
  return canApplyDirectly
    ? "Сохранить как проверенную версию"
    : "Предложить правку";
}

export function correctSuccessMessage(applied: boolean): string {
  return applied
    ? "Карточка обновлена — теперь она проверена человеком"
    : "Правка отправлена куратору на проверку";
}

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
