"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Merge,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import type { ContactDTO } from "@nyxmail/shared";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { useToast } from "@/lib/client/toast";
import { downloadText } from "@/lib/client/utils";

export function ContactsModal({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [contacts, setContacts] = useState<ContactDTO[]>([]);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async (q = "") => {
    try {
      const data = await apiFetch<{ contacts: ContactDTO[] }>(
        `/api/v1/contacts?limit=200${q ? `&q=${encodeURIComponent(q)}` : ""}`,
      );
      setContacts(data.contacts);
    } catch {
      toast({ title: "Could not load contacts", tone: "error" });
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timeout = setTimeout(() => void load(query), 250);
    return () => clearTimeout(timeout);
  }, [query, open]);

  const filtered = useMemo(() => contacts, [contacts]);

  const addContact = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/api/v1/contacts", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      setName("");
      setEmail("");
      await load(query);
      onChanged();
      toast({ title: "Contact saved", tone: "success" });
    } catch (caught) {
      toast({
        title: "Contact could not be saved",
        description: caught instanceof ApiClientError ? caught.message : undefined,
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const contact = contacts.find((item) => item.id === id);
    await confirm({
      title: "Delete this contact?",
      description: contact
        ? `${contact.name} will be removed from your address book.`
        : "This contact will be removed from your address book.",
      confirmLabel: "Delete contact",
      tone: "danger",
      icon: <Trash2 className="h-5 w-5" />,
      details: contact ? [{ label: "Contact", value: contact.name }] : undefined,
      onConfirm: async () => {
        try {
          await apiFetch(`/api/v1/contacts/${id}`, { method: "DELETE" });
          setContacts((current) => current.filter((item) => item.id !== id));
          setSelected((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
          onChanged();
        } catch {
          toast({ title: "Could not delete contact", tone: "error" });
        }
      },
    });
  };

  const merge = async () => {
    if (selected.size < 2) return;
    try {
      const result = await apiFetch<{ merged: number }>("/api/v1/contacts/merge", {
        method: "POST",
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      setSelected(new Set());
      await load(query);
      onChanged();
      toast({ title: `${result.merged} duplicate contact${result.merged === 1 ? "" : "s"} merged`, tone: "success" });
    } catch {
      toast({ title: "Merge failed", tone: "error" });
    }
  };

  const importVcard = async (file: File) => {
    try {
      const text = await file.text();
      const result = await apiFetch<{ created: number; updated: number }>("/api/v1/contacts/vcard", {
        method: "POST",
        body: JSON.stringify({ vcard: text }),
      });
      await load(query);
      onChanged();
      toast({
        title: "Contacts imported",
        description: `${result.created} created, ${result.updated} updated.`,
        tone: "success",
      });
    } catch (caught) {
      toast({
        title: "vCard import failed",
        description: caught instanceof ApiClientError ? caught.message : undefined,
        tone: "error",
      });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Contacts"
      description="Collected automatically from senders and recipients. Stored locally in your NyxMail database."
      width="lg"
    >
      <div className="space-y-4 p-5">
        <form onSubmit={addContact} className="grid gap-2 rounded-xl border border-border bg-canvas p-3 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            aria-label="Contact name"
            placeholder="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={160}
          />
          <Input
            aria-label="Contact email"
            type="email"
            placeholder="email@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <Button type="submit" loading={busy} size="sm" icon={<Plus className="h-3.5 w-3.5" />}>
            Add
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search contacts"
              className="h-9 w-full rounded-lg border border-border bg-canvas pl-8 pr-3 text-xs text-ink outline-none focus:border-accent/50"
              aria-label="Search contacts"
            />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".vcf,text/vcard"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importVcard(file);
              event.target.value = "";
            }}
          />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Import vCard
          </button>
          <a href="/api/v1/contacts/vcard" download className="btn btn-secondary btn-sm">
            <Download className="h-3.5 w-3.5" /> Export
          </a>
          {selected.size >= 2 && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void merge()}>
              <Merge className="h-3.5 w-3.5" /> Merge {selected.size}
            </button>
          )}
        </div>

        <div className="max-h-[45vh] overflow-y-auto rounded-xl border border-border">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <Users className="h-6 w-6 text-faint" />
              <p className="text-xs font-medium text-ink">No contacts yet</p>
              <p className="text-[11px] text-muted">Send a message or import a vCard file to get started.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((contact) => (
                <div key={contact.id} className="group flex items-center gap-3 px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-[#6D4AFF]"
                    checked={selected.has(contact.id)}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(contact.id)) next.delete(contact.id);
                        else next.add(contact.id);
                        return next;
                      })
                    }
                    aria-label={`Select ${contact.name}`}
                  />
                  <Avatar name={contact.name} email={contact.email} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-ink">{contact.name}</p>
                    <p className="truncate text-[10px] text-faint">{contact.email}</p>
                  </div>
                  <button
                    type="button"
                    className="icon-btn h-7 w-7 opacity-0 group-hover:opacity-100"
                    onClick={() => void remove(contact.id)}
                    aria-label={`Delete ${contact.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const shortcuts = [
    ["⌘ K / Ctrl K", "Open the command palette"],
    ["c", "Compose a new message"],
    ["/", "Focus search"],
    ["j / k", "Next / previous conversation"],
    ["Enter", "Open focused conversation"],
    ["r", "Reply"],
    ["a", "Reply all"],
    ["f", "Forward"],
    ["e", "Archive conversation"],
    ["#", "Move conversation to trash"],
    ["u", "Toggle read / unread"],
    ["s", "Star conversation"],
    ["g then i", "Go to Inbox"],
    ["Esc", "Close dialog or reader"],
    ["?", "Show this shortcut guide"],
  ];
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" description="Built for an inbox you can run without a mouse." width="md">
      <div className="grid gap-1.5 p-5 sm:grid-cols-2">
        {shortcuts.map(([key, action]) => (
          <div key={key} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-canvas px-3 py-2">
            <span className="text-[11px] text-muted">{action}</span>
            <kbd className="shrink-0">{key}</kbd>
          </div>
        ))}
      </div>
    </Modal>
  );
}
