"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { cardsApi, type CreateCardRequest } from "@/api/cards.api";
import { ApiError, humanizeApiError } from "@/api/api-error";
import { Button } from "@/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";
import { Textarea } from "@/ui/shadcn/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";

export function CreateCardDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (cardId: string) => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CreateCardRequest["kind"]>("client");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [description, setDescription] = useState("");

  function reset() {
    setName("");
    setKind("client");
    setContactName("");
    setContactEmail("");
    setContactPhone("");
    setDescription("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!name.trim()) {
      toast.error("Укажите название карточки");
      return;
    }
    setSubmitting(true);
    try {
      const created = await cardsApi.create({
        name: name.trim(),
        kind,
        contactName: contactName.trim() || null,
        contactEmail: contactEmail.trim() || null,
        contactPhone: contactPhone.trim() || null,
        description: description.trim() || null,
      });
      toast.success("Карточка создана");
      onCreated?.(created.id);
      onOpenChange(false);
      reset();
      router.push(`/cards/${encodeURIComponent(created.id)}`);
    } catch (err) {
      const msg = humanizeApiError(err, "Не удалось создать карточку");
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новая карточка</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div>
            <Label htmlFor="card-name">Название</Label>
            <Input
              id="card-name"
              autoFocus
              required
              value={name}
              maxLength={200}
              placeholder="Иван Петров / Сделка с Acme"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label>Тип</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as CreateCardRequest["kind"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="client">Клиент</SelectItem>
                <SelectItem value="deal">Сделка</SelectItem>
                <SelectItem value="project">Проект</SelectItem>
                <SelectItem value="topic">Тема</SelectItem>
                <SelectItem value="custom">Прочее</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="card-contact-name">Контакт</Label>
              <Input
                id="card-contact-name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Имя"
              />
            </div>
            <div>
              <Label htmlFor="card-contact-email">Email</Label>
              <Input
                id="card-contact-email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="email@example.com"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="card-contact-phone">Телефон</Label>
            <Input
              id="card-contact-phone"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+7 ..."
            />
          </div>
          <div>
            <Label htmlFor="card-description">Описание</Label>
            <Textarea
              id="card-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Краткое примечание"
              rows={3}
              maxLength={5000}
            />
          </div>
          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Создаём…" : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
