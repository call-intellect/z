import type { ChecklistsService } from './checklists.service';

interface RawChecklistItem {
  text?: string;
}

interface RawChecklist {
  title?: string;
  items?: RawChecklistItem[];
}

export async function materializeIntakeChecklist(
  checklists: ChecklistsService,
  issueId: string,
  checklistJson: unknown,
  tenantId: string,
): Promise<void> {
  if (!Array.isArray(checklistJson)) return;

  for (const cl of checklistJson as RawChecklist[]) {
    const items = (cl?.items ?? [])
      .map((i) => String(i?.text ?? '').trim().slice(0, 500))
      .filter(Boolean)
      .slice(0, 50);
    if (items.length === 0) continue;

    const created = await checklists.createChecklist(
      issueId,
      { title: cl?.title ?? 'Чек-лист' },
      tenantId,
    );
    await checklists.bulkCreateItems(
      created.id,
      { checklistId: created.id, lines: items },
      tenantId,
    );
  }
}
