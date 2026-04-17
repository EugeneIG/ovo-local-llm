import { useTranslation } from "react-i18next";
import { X, Link as LinkIcon, File as FileIcon } from "lucide-react";
import type { ChatAttachment } from "../types/ovo";

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
  const isFile = attachment.kind === "file";
  const preview = isFile ? attachment.previewDataUrl : null;

  return (
    <div className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-md bg-white/80 border border-[#E8CFBB] text-xs text-[#2C1810] max-w-[240px]">
      {preview ? (
        <img
          src={preview}
          alt=""
          className="w-8 h-8 rounded object-cover shrink-0"
        />
      ) : (
        <div className="w-8 h-8 rounded bg-[#FAF3E7] flex items-center justify-center shrink-0 text-[#8B4432]">
          {isFile ? <FileIcon className="w-4 h-4" aria-hidden /> : <LinkIcon className="w-4 h-4" aria-hidden />}
        </div>
      )}
      <div className="flex-1 min-w-0">
        {isFile ? (
          <>
            <div className="truncate">{attachment.file.name}</div>
            <div className="text-[10px] text-[#8B4432]">{formatSize(attachment.file.size)}</div>
          </>
        ) : (
          <>
            <div className="truncate">{hostOrShortUrl(attachment.url)}</div>
            <div className="text-[10px] text-[#8B4432]">URL</div>
          </>
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(attachment.id)}
          aria-label={t("chat.remove_attachment")}
          className="p-0.5 rounded hover:bg-[#FAF3E7] text-[#8B4432] hover:text-[#2C1810] transition"
        >
          <X className="w-3.5 h-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
