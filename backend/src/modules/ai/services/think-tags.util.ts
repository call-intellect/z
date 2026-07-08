const THINK_BLOCK_RE = /<think>[\s\S]*?<\/think>\s*/gi;
const UNCLOSED_THINK_RE = /<think>[\s\S]*$/i;

export function stripThinkTags(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  const closed = input.replace(THINK_BLOCK_RE, '');
  const unclosed = closed.replace(UNCLOSED_THINK_RE, '');
  return unclosed.trim();
}

export function hasThinkTags(input: string): boolean {
  if (typeof input !== 'string') return false;
  return /<think>/i.test(input);
}
