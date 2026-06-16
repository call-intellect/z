"use client";

import { useEffect, useMemo, useState } from "react";
import { Save, X } from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/api-error";
import { adminSystemMessagesApi } from "@/api/admin-system-messages.api";
import type { AdminOrgRowDomain } from "@/domain/admin-org";
import type {
  CreateSystemMessageRequest,
  SystemMessageItemDomain,
  UpdateSystemMessageRequest,
} from "@/domain/admin-system-message";
import { Badge } from "@/ui/shadcn/badge";
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
  item: SystemMessageItemDomain | null;
  defaultType: string;
  orgs: AdminOrgRowDomain[];
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSaved: () => void;
};

export function MessageEditDialog({
  item,
  defaultType,
  orgs,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const isEdit = item !== null;

  const [type, setType] = useState<string>(defaultType);
  const [severity, setSeverity] = useState<string>("info");
  const [body, setBody] = useState("");
  const [startsAt, setStartsAt] = useState<string>("");
  const [endsAt, setEndsAt] = useState<string>("");
  const [isActive, setIsActive] = useState(true);
  const [targetOrgs, setTargetOrgs] = useState<string[]>([]);
  const [orgFilter, setOrgFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (item) {
      setType(item.type);
      setSeverity(item.severity);
      setBody(item.body);
      setStartsAt(toInputDateTime(item.startsAt));
      setEndsAt(toInputDateTime(item.endsAt));
      setIsActive(item.isActive);
      setTargetOrgs([...item.targetOrgs]);
    } else {
      setType(defaultType);
      setSeverity("info");
      setBody("");
      setStartsAt("");
      setEndsAt("");
      setIsActive(true);
      setTargetOrgs([]);
    }
    setOrgFilter("");
  }, [open, item, defaultType]);

  const filteredOrgs = useMemo(() => {
    const q = orgFilter.trim().toLowerCase();
    const notSelected = orgs.filter((o) => !targetOrgs.includes(o.id));
    if (!q) return notSelected.slice(0, 30);
    return notSelected
      .filter(
        (o) =>
          o.id.toLowerCase().includes(q) ||
          o.name.toLowerCase().includes(q) ||
          o.slug.toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [orgs, orgFilter, targetOrgs]);

  const selectedOrgs = useMemo(
    () =>
      targetOrgs.map((id) => orgs.find((o) => o.id === id) ?? { id, name: id }),
    [targetOrgs, orgs],
  );

  const canSave = body.trim().length > 0 && type && severity;

  const handleSave = async () => {
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      if (!isEdit) {
        const payload: CreateSystemMessageRequest = {
          type,
          severity,
          body,
          isActive,
          targetOrgs,
        };
        if (startsAt) payload.startsAt = new Date(startsAt).toISOString();
        if (endsAt) payload.endsAt = new Date(endsAt).toISOString();
        await adminSystemMessagesApi.create(payload);
        toast.success("Сообщение создано");
      } else {
        const payload: UpdateSystemMessageRequest = {
          type,
          severity,
          body,
          isActive,
          targetOrgs,
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        };
        await adminSystemMessagesApi.update(item!.id, payload);
        toast.success("Сообщение обновлено");
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
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Редактировать сообщение" : "Создать сообщение"}
          </DialogTitle>
          <DialogDescription>
            Пустой список «Получатели» = показать всем Org. Пустые даты =
            показывать без ограничения по времени.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="sm-type">Тип</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="sm-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="banner">Баннер</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="alert">Алёрт</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="sm-sev">Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger id="sm-sev">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Инфо</SelectItem>
                  <SelectItem value="warning">Предупреждение</SelectItem>
                  <SelectItem value="critical">Критично</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="sm-starts">Показывать с</Label>
              <Input
                id="sm-starts"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="sm-ends">Показывать до</Label>
              <Input
                id="sm-ends"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch
                checked={isActive}
                onCheckedChange={(v) => setIsActive(v)}
              />
              <Label className="!mb-0">Активно</Label>
              <p className="text-[11px] text-fg-tertiary">
                Если выключено — сообщение не показывается даже в окне
                «Показывать с/до».
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="sm-body">Текст</Label>
            <Textarea
              id="sm-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              maxLength={4000}
              placeholder="Текст сообщения. Markdown не парсится."
            />
          </div>

          <section className="space-y-2 rounded-md border border-border-subtle p-4">
            <header>
              <h3 className="text-sm font-medium">Получатели</h3>
              <p className="text-xs text-fg-tertiary">
                Если ничего не выбрано — сообщение показывается всем Org.
              </p>
            </header>
            {selectedOrgs.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selectedOrgs.map((o) => (
                  <Badge
                    key={o.id}
                    variant="secondary"
                    className="gap-1 text-xs"
                  >
                    {o.name}
                    <button
                      type="button"
                      onClick={() =>
                        setTargetOrgs((prev) =>
                          prev.filter((id) => id !== o.id),
                        )
                      }
                      className="inline-flex items-center text-fg-tertiary hover:text-danger"
                      title="Убрать"
                    >
                      <X size={12} />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            <Input
              value={orgFilter}
              onChange={(e) => setOrgFilter(e.target.value)}
              placeholder="Поиск Org по имени, slug или id…"
            />
            {orgs.length === 0 ? (
              <p className="text-xs text-fg-tertiary">
                Список Org не загружен — выберите Org вручную невозможно.
              </p>
            ) : (
              <div className="max-h-[180px] space-y-0.5 overflow-y-auto rounded-md border border-border-subtle">
                {filteredOrgs.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-fg-tertiary">
                    Ничего не найдено.
                  </p>
                ) : (
                  filteredOrgs.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-bg-overlay"
                      onClick={() => {
                        setTargetOrgs((prev) => [...prev, o.id]);
                        setOrgFilter("");
                      }}
                    >
                      <span className="font-medium">{o.name}</span>
                      <span className="font-mono text-[10px] text-fg-tertiary">
                        {o.slug}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </section>

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

function toInputDateTime(d: Date | null): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
