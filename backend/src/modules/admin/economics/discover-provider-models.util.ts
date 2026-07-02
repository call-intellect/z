export interface DiscoverModelsParams {
  baseUrl: string;
  apiKey: string | null;
  defaultHeaders?: Record<string, string> | null;
  timeoutMs?: number | null;
}

export interface DiscoveredModel {
  id: string;
}

export async function discoverProviderModels(p: DiscoverModelsParams): Promise<DiscoveredModel[]> {
  const base = p.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = { ...(p.defaultHeaders ?? {}) };
  if (p.apiKey) headers['Authorization'] = `Bearer ${p.apiKey}`;
  const resp = await fetch(`${base}/models`, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(p.timeoutMs ?? 15_000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`discover-provider-models: HTTP ${resp.status}: ${body.slice(0, 300)}`);
  }
  const json = (await resp.json()) as { data?: Array<{ id?: string }> };
  const data = Array.isArray(json.data) ? json.data : [];
  return data.filter((m): m is { id: string } => typeof m.id === 'string').map((m) => ({ id: m.id }));
}
