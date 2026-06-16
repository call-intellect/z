"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@/api/api-error";
import { adminPromptExperimentsApi } from "@/api/admin-prompt-experiments.api";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";
import { Textarea } from "@/ui/shadcn/textarea";
import { toast } from "@/ui/shadcn/toast";

export function PromptExperimentNewClient() {
  const router = useRouter();
  const [orgId, setOrgId] = useState("");
  const [templateAId, setTemplateAId] = useState("");
  const [templateBId, setTemplateBId] = useState("");
  const [splitPercent, setSplitPercent] = useState(50);
  const [endsAt, setEndsAt] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const created = await adminPromptExperimentsApi.create({
        orgId: orgId.trim() || null,
        templateAId: templateAId.trim(),
        templateBId: templateBId.trim(),
        splitPercent,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        notes: notes.trim() || null,
      });
      toast.success("Эксперимент создан");
      router.push(`/admin/prompts/experiments/${created.id}`);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.message}${err.code ? ` (${err.code})` : ""}`
          : "Не удалось создать эксперимент";
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        href="/admin/prompts/experiments"
        className="text-sm text-fg-secondary hover:underline"
      >
        ← К списку экспериментов
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
        Новый эксперимент
      </h1>
      <p className="text-sm text-fg-secondary">
        Эксперимент сравнивает две версии шаблона. После создания — нужно
        запустить кнопкой «Запустить» на странице эксперимента.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="orgId">Организация (пусто = глобальный)</Label>
          <Input
            id="orgId"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            placeholder="org-…"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="templateAId">ID версии A (контроль)</Label>
            <Input
              id="templateAId"
              value={templateAId}
              onChange={(e) => setTemplateAId(e.target.value)}
              placeholder="v-…"
              required
            />
          </div>
          <div>
            <Label htmlFor="templateBId">ID версии B (вариант)</Label>
            <Input
              id="templateBId"
              value={templateBId}
              onChange={(e) => setTemplateBId(e.target.value)}
              placeholder="v-…"
              required
            />
          </div>
        </div>

        <div>
          <Label htmlFor="split">Доля трафика на группу B, %</Label>
          <Input
            id="split"
            type="number"
            min={0}
            max={100}
            value={splitPercent}
            onChange={(e) =>
              setSplitPercent(
                Math.max(0, Math.min(100, Number(e.target.value))),
              )
            }
            required
          />
        </div>

        <div>
          <Label htmlFor="endsAt">Окончание (не позже 30 дней)</Label>
          <Input
            id="endsAt"
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
          <p className="mt-1 text-xs text-fg-secondary">
            Пусто = эксперимент остановится только вручную.
          </p>
        </div>

        <div>
          <Label htmlFor="notes">Комментарий</Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Какую гипотезу проверяем?"
          />
        </div>

        {errorMsg ? (
          <div className="rounded-md border border-chip-danger-bg bg-chip-danger-bg p-3 text-sm text-chip-danger-fg">
            {errorMsg}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" asChild>
            <Link href="/admin/prompts/experiments">Отмена</Link>
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Создаём…" : "Создать эксперимент"}
          </Button>
        </div>
      </form>
    </div>
  );
}
