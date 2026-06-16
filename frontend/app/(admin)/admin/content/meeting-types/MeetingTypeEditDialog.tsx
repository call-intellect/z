"use client";

import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/api-error";
import { adminMeetingTypesApi } from "@/api/admin-meeting-types.api";
import {
  MEETING_TYPE_DEFAULT_LABELS,
  MEETING_TYPE_IDS,
  type CreateMeetingTypeRequest,
  type MeetingTypeItemDomain,
  type UpdateMeetingTypeRequest,
} from "@/domain/admin-meeting-type";
import { Button } from "@/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";
import { Switch } from "@/ui/shadcn/switch";
import { Textarea } from "@/ui/shadcn/textarea";

type Props = {
  item: MeetingTypeItemDomain | null;
  existingIds: string[];
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSaved: () => void;
};

export function MeetingTypeEditDialog({
  item,
  existingIds,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const isEdit = item !== null;

  const [id, setId] = useState<string>("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");
  const [reportPromptKey, setReportPromptKey] = useState("");
  const [sortOrder, setSortOrder] = useState<string>("0");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableIds = useMemo(
    () =>
      MEETING_TYPE_IDS.filter((candidate) => !existingIds.includes(candidate)),
    [existingIds],
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (item) {
      setId(item.id);
      setDisplayName(item.displayName);
      setDescription(item.description ?? "");
      setIcon(item.icon ?? "");
      setReportPromptKey(item.reportPromptKey ?? "");
      setSortOrder(String(item.sortOrder));
      setIsActive(item.isActive);
    } else {
      setId(availableIds[0] ?? "");
      setDisplayName(
        availableIds[0]
          ? (MEETING_TYPE_DEFAULT_LABELS[availableIds[0]] ?? "")
          : "",
      );
      setDescription("");
      setIcon("");
      setReportPromptKey("");
      setSortOrder("0");
      setIsActive(true);
    }
  }, [open, item, availableIds]);

  const canSave = isEdit
    ? displayName.trim().length > 0
    : id.trim().length > 0 && displayName.trim().length > 0;

  const handleSave = async () => {
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      if (!isEdit) {
        const body: CreateMeetingTypeRequest = {
          id: id.trim(),
          displayName: displayName.trim(),
        };
        if (description.trim()) body.description = description.trim();
        if (icon.trim()) body.icon = icon.trim();
        if (reportPromptKey.trim())
          body.reportPromptKey = reportPromptKey.trim();
        if (sortOrder.trim()) {
          const s = Number(sortOrder);
          if (Number.isFinite(s) && s >= 0) body.sortOrder = Math.floor(s);
        }
        await adminMeetingTypesApi.create(body);
        toast.success(`Тип «${id}» создан`);
      } else {
        const body: UpdateMeetingTypeRequest = {
          displayName: displayName.trim(),
          description: description.trim() || null,
          icon: icon.trim() || null,
          reportPromptKey: reportPromptKey.trim() || null,
          isActive,
        };
        if (sortOrder.trim()) {
          const s = Number(sortOrder);
          if (Number.isFinite(s) && s >= 0) body.sortOrder = Math.floor(s);
        }
        await adminMeetingTypesApi.update(item!.id, body);
        toast.success(`Тип «${item!.id}» обновлён`);
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Не удалось сохранить";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Редактировать тип «${item!.id}»` : "Создать тип встречи"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "id типа нельзя изменить — он привязан к значению enum MeetingType."
              : "Id выбирается из enum MeetingType. Если нужного значения нет в списке — добавьте его в schema.prisma и сделайте db push."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="mt-id">
                Id <span className="text-danger">*</span>
              </Label>
              {isEdit ? (
                <Input id="mt-id" value={id} disabled />
              ) : availableIds.length === 0 ? (
                <p className="rounded-md border border-border-subtle px-3 py-2 text-xs text-fg-tertiary">
                  Все значения enum уже добавлены — новый id создать нельзя.
                </p>
              ) : (
                <Select value={id} onValueChange={setId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите id" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableIds.map((candidate) => (
                      <SelectItem key={candidate} value={candidate}>
                        <span className="font-mono text-xs">{candidate}</span>
                        <span className="ml-2 text-fg-tertiary">
                          {MEETING_TYPE_DEFAULT_LABELS[candidate] ?? ""}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="mt-name">
                Название <span className="text-danger">*</span>
              </Label>
              <Input
                id="mt-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Интервью кандидата"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="mt-icon">Иконка</Label>
              <Input
                id="mt-icon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="lucide:user-square"
              />
              <p className="text-[11px] text-fg-tertiary">
                Произвольный ключ — формат на усмотрение фронта.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="mt-prompt">Ключ промпта отчёта</Label>
              <Input
                id="mt-prompt"
                value={reportPromptKey}
                onChange={(e) => setReportPromptKey(e.target.value)}
                placeholder="meeting_report_interview"
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-fg-tertiary">
                FK на PromptTemplate.key (без явной relation в БД).
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="mt-sort">Порядок сортировки</Label>
              <Input
                id="mt-sort"
                type="number"
                min={0}
                step={1}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </div>

            {isEdit && (
              <div className="flex items-center gap-2 sm:col-span-2">
                <Switch
                  checked={isActive}
                  onCheckedChange={(v) => setIsActive(v)}
                />
                <Label className="!mb-0">Активен</Label>
                <p className="text-[11px] text-fg-tertiary">
                  Неактивные типы скрываются из формы создания встречи, но
                  существующие встречи продолжают работать.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="mt-desc">Описание</Label>
            <Textarea
              id="mt-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Когда выбирать этот тип, что он влияет на отчёт"
            />
          </div>

          {error && (
            <p
              className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving || !canSave}
            onClick={() => void handleSave()}
          >
            <Save size={14} />
            {saving ? "Сохраняем…" : isEdit ? "Сохранить" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
