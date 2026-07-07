export interface OpenAiCompatibleEmbedParams {
  baseUrl: string;
  model: string;
  apiKey?: string | null;
  texts: string[];
}

export async function openaiCompatibleEmbed(p: OpenAiCompatibleEmbedParams): Promise<number[][]> {
  if (p.texts.length === 0) return [];

  const url = p.baseUrl.replace(/\/+$/u, '') + '/embeddings';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (p.apiKey) {
    headers['Authorization'] = `Bearer ${p.apiKey}`;
  }
  const body = JSON.stringify({ model: p.model, input: p.texts });

  const response = await fetch(url, { method: 'POST', headers, body });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const e = new Error(`EmbedHTTP ${response.status}: ${errText.slice(0, 500)}`);
    Object.assign(e, { status: response.status });
    throw e;
  }

  const data = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const arr = Array.isArray(data.data) ? data.data : [];
  if (arr.length !== p.texts.length) {
    throw new Error(`EmbedHTTP: ожидалось ${p.texts.length} embeddings, получено ${arr.length}`);
  }
  return arr.map((row, idx) => {
    const e = row.embedding;
    if (!Array.isArray(e)) {
      throw new Error(`EmbedHTTP: пустой embedding в позиции ${idx}`);
    }
    return e;
  });
}
