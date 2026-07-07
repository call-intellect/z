export type BankItem = {
  id?: unknown;
  question?: unknown;
  chain?: unknown;
  turn?: unknown;
  [k: string]: unknown;
};

export type BankSplit = {
  singles: BankItem[];
  chains: BankItem[][];
};

export type BankError = { id: string; problem: string };

const FOLLOWUP_RE = /^\s*(а|и|он|она|оно|они|его|её|ее|их|им|ей|ему|это|этому|этим)\s/i;

export function isFollowUpShaped(question: string): boolean {
  return FOLLOWUP_RE.test(question);
}

function hasChain(b: BankItem): boolean {
  return b.chain !== undefined && b.chain !== null && b.chain !== '';
}

export function splitBank(bank: BankItem[], limit: number = Number.POSITIVE_INFINITY): BankSplit {
  const singles = bank.filter((b) => !hasChain(b)).slice(0, limit);
  const map = new Map<string, BankItem[]>();
  for (const b of bank) {
    if (!hasChain(b)) continue;
    const key = String(b.chain);
    const arr = map.get(key) ?? [];
    arr.push(b);
    map.set(key, arr);
  }
  const chains = [...map.values()].map((items) =>
    [...items].sort((a, b) => Number(a.turn ?? 0) - Number(b.turn ?? 0)),
  );
  return { singles, chains };
}

export function totalToRun(split: BankSplit): number {
  return split.singles.length + split.chains.reduce((n, c) => n + c.length, 0);
}

export function validateBank(bank: BankItem[]): BankError[] {
  const errors: BankError[] = [];
  const chainTurns = new Map<string, number[]>();

  for (const b of bank) {
    const id = String(b.id ?? '?');
    const q = String(b.question ?? '');
    if (!hasChain(b) && isFollowUpShaped(q)) {
      errors.push({ id, problem: `follow-up-образный вопрос без chain: «${q}»` });
    }
    if (hasChain(b)) {
      const turnOk = b.turn !== undefined && b.turn !== null && Number.isInteger(Number(b.turn));
      if (!turnOk) {
        errors.push({ id, problem: 'chain без корректного turn' });
      } else {
        const key = String(b.chain);
        const arr = chainTurns.get(key) ?? [];
        arr.push(Number(b.turn));
        chainTurns.set(key, arr);
      }
    }
  }

  for (const [chain, turns] of chainTurns) {
    if (turns.length < 2) errors.push({ id: chain, problem: 'цепочка из одного хода' });
    const sorted = [...turns].sort((a, b) => a - b);
    if (new Set(sorted).size !== sorted.length) {
      errors.push({ id: chain, problem: 'дубли turn в цепочке' });
    }
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] !== i + 1) {
        errors.push({ id: chain, problem: `turn не образуют 1..N: [${sorted.join(',')}]` });
        break;
      }
    }
  }

  return errors;
}
