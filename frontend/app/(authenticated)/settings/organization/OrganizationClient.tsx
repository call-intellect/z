"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { ApiError, humanizeApiError } from "@/api/api-error";
import { type OrgApi, orgsApi } from "@/api/orgs.api";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";

export function OrganizationClient() {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState<OrgApi[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editName, setEditName] = useState("");
  const [editVisibility, setEditVisibility] = useState<"open" | "strict">(
    "open",
  );
  const [savingOrg, setSavingOrg] = useState(false);

  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? null;
  const isOwner = activeOrg && user ? activeOrg.ownerId === user.id : false;

  const loadOrgs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await orgsApi.listMine();
      setOrgs(res.orgs);
      if (!activeOrgId && res.orgs.length > 0) {
        setActiveOrgId(res.orgs[0]!.id);
      }
    } catch (e) {
      setError(humanizeApiError(e, "Не удалось загрузить организации"));
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    void loadOrgs();
  }, [loadOrgs]);

  useEffect(() => {
    if (!activeOrg) return;
    setEditName(activeOrg.name);
    setEditVisibility(activeOrg.visibilityMode);
  }, [activeOrg]);

  const handleSaveOrg = async () => {
    if (!activeOrg) return;
    setSavingOrg(true);
    try {
      const res = await orgsApi.update(activeOrg.id, {
        name: editName.trim(),
        visibilityMode: editVisibility,
      });
      setOrgs((prev) => prev.map((o) => (o.id === res.org.id ? res.org : o)));
      toast.success("Настройки организации сохранены");
    } catch (e) {
      toast.error(humanizeApiError(e, "Не удалось сохранить"));
    } finally {
      setSavingOrg(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-fg-secondary">
        <Loader2 className="h-4 w-4 animate-spin" /> Загружаем…
      </div>
    );
  }
  if (error) {
    return <div className="text-sm text-status-danger">{error}</div>;
  }
  if (!activeOrg) {
    return (
      <div className="text-sm text-fg-secondary">
        У вас пока нет организаций.
      </div>
    );
  }

  return (
    <div className="w-full space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Организация</h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Настройки {activeOrg.name}
          </p>
          <p className="mt-1 text-xs text-fg-secondary">
            Участники и приглашения теперь в разделе «Команда».
          </p>
        </div>
        {orgs.length > 1 ? (
          <Select
            value={activeOrgId ?? ""}
            onValueChange={(v) => setActiveOrgId(v)}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {orgs.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </header>

      {}
      <section className="space-y-4 rounded-lg border border-border-subtle bg-bg-card p-5">
        <h2 className="text-base font-medium">Информация</h2>
        <div className="space-y-3 max-w-md">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Название</Label>
            <Input
              id="org-name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              disabled={!isOwner}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-visibility">Режим видимости</Label>
            <Select
              value={editVisibility}
              onValueChange={(v) => setEditVisibility(v as "open" | "strict")}
              disabled={!isOwner}
            >
              <SelectTrigger id="org-visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">
                  Open — менеджеры видят все ресурсы организации
                </SelectItem>
                <SelectItem value="strict">
                  Strict — менеджеры видят только свои ресурсы
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-fg-secondary">
              {editVisibility === "open"
                ? "Менеджеры могут читать встречи, карточки и задачи коллег. Писать — только свои."
                : "Каждый менеджер видит только свои встречи, карточки, задачи. Owner и admin видят всё."}
            </p>
          </div>
        </div>
        {isOwner ? (
          <Button onClick={handleSaveOrg} disabled={savingOrg}>
            {savingOrg ? "Сохраняем…" : "Сохранить"}
          </Button>
        ) : (
          <p className="text-xs text-fg-secondary">
            Только владелец организации может менять эти настройки.
          </p>
        )}
      </section>
    </div>
  );
}
