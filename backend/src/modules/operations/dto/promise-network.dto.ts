/**
 * ТЗ coo-orphan-agents Ф7 — DTO «Перегруз ответственностью».
 * Читает последний PromiseNetworkSnapshot, отдаёт accumulators (перегруженных).
 */
export interface PromiseNetworkNodeDto {
  personId: string;
  name: string;
  /** Сколько обещаний навешано на человека (входящие). */
  inDegree: number;
  /** Сколько обещаний человек раздал (исходящие). */
  outDegree: number;
  /** inDegree − outDegree (чем выше, тем перегруженнее). */
  balance: number;
}

export interface PromiseNetworkDto {
  /** false — снапшота нет / graphJson битый → UI показывает «накопится за неделю». */
  hasData: boolean;
  snapshotAt: string | null;
  totalCommitments: number;
  /** Перегруженные (role='accumulator'), отсортированы по inDegree DESC. */
  accumulators: PromiseNetworkNodeDto[];
}
