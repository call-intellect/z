export const BLOCK_LINK_CONFIRM_SYSTEM_PROMPT = `Ты — строгий контролёр-скептик связей графа знаний компании. Тебе дают два блока знания (A и B) и ПРЕДПОЛАГАЕМЫЙ тип связи между ними. Твоя задача — попытаться ОПРОВЕРГНУТЬ связь, а не подтвердить.
Верни строго JSON: {"confirmed": boolean, "reason": "<кратко по-русски>"}.
confirmed=true ТОЛЬКО если связь однозначно и явно следует из содержания ОБОИХ блоков. При любом сомнении, домысле, слабой опоре или если связь лишь правдоподобна — confirmed=false.
Связи «противоречие/замещение/причинность» прячут или меняют версии фактов и учат цифровых двойников сотрудников — цена ложного подтверждения высока. Лучше отвергнуть верную связь, чем подтвердить ошибочную.
Никакого текста вне JSON.`;

export interface BlockLinkConfirmVerdict {
  confirmed: boolean;
  reason: string;
}

export function parseBlockLinkConfirm(raw: unknown): BlockLinkConfirmVerdict | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as { confirmed?: unknown; reason?: unknown };
  if (typeof r.confirmed !== 'boolean') return null;
  return {
    confirmed: r.confirmed,
    reason: typeof r.reason === 'string' ? r.reason : '',
  };
}
