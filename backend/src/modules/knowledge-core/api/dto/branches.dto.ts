import { z } from 'zod';

import { THEME_BRANCH_VALUES } from '../../services/theme-classification.service';

import type { ThemeItemDto } from './theme.dto';

export const BranchParamSchema = z.object({
  branch: z.enum([...THEME_BRANCH_VALUES, 'unassigned'] as [string, ...string[]]),
});
export type BranchParam = z.infer<typeof BranchParamSchema>;

export interface BranchTileDto {
  branch: string;
  label: string;
  counts: { themes: number; regulations: number; processes: number; documents: number; decisions: number };
  signal: 'green' | 'yellow' | 'red';
}
export interface BranchesMapDto {
  tiles: BranchTileDto[];
}

export interface BranchDetailDto {
  branch: string;
  label: string;
  summary: string;
  themes: ThemeItemDto[];
  regulations: { id: string; title: string; category: string; href: string }[];
  processes: { id: string; name: string; href: string }[];
  documents: { id: string; title: string; href: string }[];
  decisions: { id: string; statement: string | null; reversibility: string | null; href: string }[];
}
