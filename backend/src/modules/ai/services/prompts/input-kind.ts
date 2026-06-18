export type InputKind = 'raw-transcript' | 'raw-user-text' | 'derived' | 'machine';

export const RAW_INPUT_KINDS: readonly InputKind[] = ['raw-transcript', 'raw-user-text'];

export function isRawInputKind(kind: InputKind): boolean {
  return RAW_INPUT_KINDS.includes(kind);
}
