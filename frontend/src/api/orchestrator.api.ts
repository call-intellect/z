import { apiClient } from "./api-client";

export type OrchestratorAgentType =
  | "entity_research"
  | "comparison"
  | "topic_summary"
  | "timeline_construction";

export interface OrchestratorPlanStepApi {
  stepIndex: number;
  agentType: OrchestratorAgentType;
  description: string;
  contextSlice: {
    focus: string;
    seedHints?: string[];
    params?: Record<string, unknown>;
  };
}

export interface OrchestratorPlanApi {
  rationale: string;
  steps: OrchestratorPlanStepApi[];
}

export interface OrchestratorSynthesisApi {
  text: string;
  citations: Array<{ type: string; id: string; snippet?: string }>;
  usedSteps: number[];
}

export interface OrchestratorVerificationApi {
  confidence: number;
  reasoning: string;
  retried: boolean;
}

export type OrchestratorStreamEvent =
  | { type: "started"; runId: string }
  | { type: "plan"; plan: OrchestratorPlanApi }
  | {
      type: "subagent_started";
      stepIndex: number;
      agentType: OrchestratorAgentType;
      description: string;
    }
  | {
      type: "subagent_completed";
      stepIndex: number;
      agentType: OrchestratorAgentType;
      ok: boolean;
      preview: string;
    }
  | { type: "synthesis"; synthesis: OrchestratorSynthesisApi }
  | { type: "verification"; verification: OrchestratorVerificationApi }
  | { type: "done"; runId: string }
  | { type: "error"; code: string; message: string }
  | { type: "cancelled" };

export interface OrchestratorRunDetailApi {
  id: string;
  tenantId: string;
  userId: string;
  task: string;
  status: string;
  planJson: OrchestratorPlanApi | null;
  synthesisJson: OrchestratorSynthesisApi | null;
  verificationJson: OrchestratorVerificationApi | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  jobs: Array<{
    id: string;
    stepIndex: number;
    agentType: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    errorMessage: string | null;
  }>;
}

export async function* streamOrchestratorRun(
  body: { task: string; depth?: number },
  signal?: AbortSignal,
): AsyncGenerator<OrchestratorStreamEvent, void, unknown> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/v1/orchestrator/runs`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Orchestrator SSE: HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (raw.startsWith(":")) continue;
        const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        try {
          const ev = JSON.parse(payload) as OrchestratorStreamEvent;
          yield ev;
          if (ev.type === "done" || ev.type === "error") return;
        } catch {}
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

export const orchestratorApi = {
  getRun: (id: string) =>
    apiClient.get<OrchestratorRunDetailApi>(
      `/api/v1/orchestrator/runs/${encodeURIComponent(id)}`,
    ),

  cancel: (id: string) =>
    apiClient.post<{ ok: true; status: string }>(
      `/api/v1/orchestrator/runs/${encodeURIComponent(id)}/cancel`,
      {},
    ),
};
