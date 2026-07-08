const DIM = 1536;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^0-9a-zа-я]+/i)
    .filter((t) => t.length >= 3);
}

export function stubEmbed(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0);
  for (const tok of tokenize(text)) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i += 1) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    vec[Math.abs(h) % DIM] += 1;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) {
    vec[0] = 1;
    return vec;
  }
  for (let i = 0; i < DIM; i += 1) vec[i] /= norm;
  return vec;
}

export function stubEmbedLiteral(text: string): string {
  return `[${stubEmbed(text).join(',')}]`;
}
