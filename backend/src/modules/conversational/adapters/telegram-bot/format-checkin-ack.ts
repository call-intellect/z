export interface CheckinAckArgs {
  kind: 'morning' | 'evening';
  wasReplace: boolean;
  plansCount: number;
  donesCount: number;
  blockersCount: number;
  lowParserConfidence: boolean;
}

export function formatCheckinAck(args: CheckinAckArgs): string {
  if (args.lowParserConfidence) {
    const label = args.kind === 'morning' ? 'план дня' : 'отчёт за день';
    const labelAccusative = args.kind === 'morning' ? 'план' : 'отчёт';
    return [
      `✅ Сохранил как ${label}, но не уверен в разборке.`,
      'Оператор перепроверит.',
      `Если это была не ${labelAccusative}, напиши «не считать чек-ином», и я перевешу как заметку.`,
    ].join(' ');
  }

  if (args.kind === 'morning') {
    const summary = formatMorningSummary(args.plansCount, args.blockersCount);
    if (args.wasReplace) {
      return [
        `✅ Заменил утренний план.`,
        summary ? `Сохранил: ${summary}.` : 'План обновлён.',
        'Если хотел дополнить — пришли полный обновлённый план, я не помню предыдущие пункты.',
      ].join(' ');
    }
    return [
      `✅ Принял утренний план.`,
      summary ? `Сохранил: ${summary}.` : 'План сохранён.',
      'Откроется в дашборде руководителя.',
    ].join(' ');
  }

  const summary = formatEveningSummary(args.donesCount, args.blockersCount);
  if (args.wasReplace) {
    return [
      `✅ Заменил вечерний отчёт.`,
      summary ? `Сохранил: ${summary}.` : 'Отчёт обновлён.',
      'Если хотел дополнить — пришли полный обновлённый отчёт.',
    ].join(' ');
  }
  return [
    `✅ Принял вечерний отчёт.`,
    summary ? `Сохранил: ${summary}.` : 'Отчёт сохранён.',
    'Дашборд обновлён.',
  ].join(' ');
}

function formatMorningSummary(plans: number, blockers: number): string {
  const parts: string[] = [];
  if (plans > 0) parts.push(`${plans} ${pluralize(plans, 'пункт', 'пункта', 'пунктов')} в плане`);
  if (blockers > 0)
    parts.push(`${blockers} ${pluralize(blockers, 'блокер', 'блокера', 'блокеров')}`);
  return parts.join(', ');
}

function formatEveningSummary(dones: number, blockers: number): string {
  const parts: string[] = [];
  if (dones > 0) parts.push(`${dones} ${pluralize(dones, 'сделанный', 'сделанных', 'сделанных')}`);
  if (blockers > 0) parts.push(`${blockers} не закрыто`);
  return parts.join(', ');
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
