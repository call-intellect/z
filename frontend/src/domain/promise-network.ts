/**
 * ТЗ coo-orphan-agents Ф7 — domain «перегруз ответственностью».
 */
import type {
  PromiseNetworkApi,
  PromiseNetworkNodeApi,
} from '@/api/operations-dashboard.api';

export interface PromiseNetworkNodeDomain {
  personId: string;
  name: string;
  inDegree: number;
  outDegree: number;
  balance: number;
}

export interface PromiseNetworkDomain {
  hasData: boolean;
  snapshotAt: Date | null;
  totalCommitments: number;
  accumulators: PromiseNetworkNodeDomain[];
}

export function fromPromiseNetworkApi(api: PromiseNetworkApi): PromiseNetworkDomain {
  return {
    hasData: api.hasData,
    snapshotAt: api.snapshotAt ? new Date(api.snapshotAt) : null,
    totalCommitments: api.totalCommitments,
    accumulators: api.accumulators.map((n: PromiseNetworkNodeApi) => ({
      personId: n.personId,
      name: n.name,
      inDegree: n.inDegree,
      outDegree: n.outDegree,
      balance: n.balance,
    })),
  };
}
