"use client";

import { useState } from "react";
import { Download, FileArchive, FileImage, FileText, Loader2 } from "lucide-react";
import type { ClientAttachmentMeta } from "@nyxmail/shared";
import type { KeyBundle } from "@nyxmail/crypto";
import { saveAttachment } from "@/lib/client/mail-crypto";
import { useToast } from "@/lib/client/toast";
import { formatBytes } from "@/lib/client/utils";

function iconFor(mime: string) {
  if (mime.startsWith("image/")) return FileImage;
  if (/zip|tar|gzip|compressed|archive/i.test(mime)) return FileArchive;
  return FileText;
}

export function AttachmentChip({
  attachment,
  bundle,
}: {
  attachment: ClientAttachmentMeta;
  bundle: KeyBundle;
}) {
  const [downloading, setDownloading] = useState(false);
  const { toast } = useToast();
  const Icon = iconFor(attachment.mimeType);

  const download = async () => {
    setDownloading(true);
    try {
      await saveAttachment(attachment, bundle);
    } catch {
      toast({ title: "Attachment could not be decrypted", tone: "error" });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={download}
      disabled={downloading}
      className="group flex w-full max-w-xs items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent/30 hover:bg-raised/50 disabled:opacity-60"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/[0.08] text-accent2">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11.5px] font-medium text-ink">{attachment.filename}</span>
        <span className="block text-[10px] text-faint">
          {formatBytes(attachment.sizeBytes)} · encrypted
        </span>
      </span>
      {downloading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-faint" />
      ) : (
        <Download className="h-3.5 w-3.5 text-faint transition-colors group-hover:text-ink" />
      )}
    </button>
  );
}
