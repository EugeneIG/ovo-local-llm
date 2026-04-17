import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Link as LinkIcon, File as FileIcon, FileAudio } from "lucide-react";
import type { ChatAttachment } from "../types/ovo";
// [START] Phase A — resolveAttachmentSrcUrl for stored kind
import { resolveAttachmentSrcUrl } from "../lib/attachmentStorage";
// [END]

interface Props {
  attachment: ChatAttachment;
  onRemove?: (id: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function hostOrShortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

export function AttachmentChip({ attachment, onRemove }: Props) {
  const { t } = useTranslation();
  // [START] Phase A — resolve src URL for stored attachments
  const [storedSrc, setStoredSrc] = useState<string | null>(null);

  useEffect(() => {
    if (attachment.kind !== "stored") return;
    if (!attachment.meta.mime.startsWith("image/")) return;
    let cancelled = false;
    resolveAttachmentSrcUrl(attachment.meta).then((url) => {
      if (!cancelled) setStoredSrc(url);
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [attachment]);
  // [END]

  const isFile = attachment.kind === "file";
  const isStored = attachment.kind === "stored";
  const isUrl = attachment.kind === "url";

  // [START] Phase B — derive MIME for file/stored kinds to pick the right icon
  const mime = isFile
    ? attachment.file.type
    : isStored
      ? attachment.meta.mime
      : null;
  const isAudioAttachment = mime?.startsWith("audio/") ?? false;
  // [END]

  const previewSrc = isFile
    ? attachment.previewDataUrl
    : isStored
      ? storedSrc
      : null;

  const name = isFile
    ? attachment.file.name
    : isStored
      ? attachment.meta.filename
      : null;

  const size = isFile
    ? attachment.file.size
    : isStored
      ? attachment.meta.size
      : null;

  return (
    <div className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-md bg-ovo-assistant border border-ovo-border text-xs text-ovo-text max-w-[240px]">
      {previewSrc ? (
        <img
          src={previewSrc}
          alt=""
          className="w-8 h-8 rounded object-cover shrink-0"
        />
      ) : (
        <div className="w-8 h-8 rounded bg-ovo-chip flex items-center justify-center shrink-0 text-ovo-muted">
          {isUrl
            ? <LinkIcon className="w-4 h-4" aria-hidden />
            : isAudioAttachment
              ? <FileAudio className="w-4 h-4" aria-hidden />
              : <FileIcon className="w-4 h-4" aria-hidden />}
        </div>
      )}
      <div className="flex-1 min-w-0">
        {isUrl ? (
          <>
            <div className="truncate">{hostOrShortUrl(attachment.url)}</div>
            <div className="text-[10px] text-ovo-muted">URL</div>
          </>
        ) : (
          <>
            <div className="truncate">{name ?? ""}</div>
            {size !== null && (
              <div className="text-[10px] text-ovo-muted">{formatSize(size)}</div>
            )}
          </>
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(attachment.id)}
          aria-label={t("chat.remove_attachment")}
          className="p-0.5 rounded hover:bg-ovo-chip text-ovo-muted hover:text-ovo-text transition"
        >
          <X className="w-3.5 h-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
