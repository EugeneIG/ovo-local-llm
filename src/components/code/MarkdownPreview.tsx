// [START] Phase 5 — Markdown Preview (Enhanced-style).
// Side-by-side live render of the active .md tab using the same
// react-markdown + remark-gfm + rehype-highlight stack that the chat
// MessageRenderer uses. Supports headings, tables, code fences with
// syntax highlighting, task lists, link rewriting, and emojis. The
// preview content comes from the editor's `content` prop so it updates
// on every keystroke without a debounce — ReactMarkdown's reconciliation
// is cheap at the document sizes typical for markdown notes.
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

interface MarkdownPreviewProps {
  content: string;
  /** Filename for the "Preview of X.md" header. */
  path: string;
}

export function MarkdownPreview({ content, path }: MarkdownPreviewProps) {
  // Memoize the doc so identical typing ticks don't re-run the markdown
  // pipeline. Doesn't help for unique edits but cheap insurance.
  const doc = useMemo(() => content, [content]);
  const filename = path.split("/").pop() ?? path;

  return (
    <div className="h-full flex flex-col bg-ovo-bg">
      <div className="flex items-center justify-between px-4 py-2 border-b border-ovo-border bg-ovo-surface shrink-0">
        <div className="flex items-center gap-2 text-[11px] text-ovo-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-ovo-accent" aria-hidden />
          <span className="font-medium text-ovo-text">{filename}</span>
          <span className="opacity-60">· Preview</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <article
          className="mx-auto max-w-[68ch] px-8 py-8 text-[15px] text-ovo-text leading-[1.75]
            prose prose-invert prose-base max-w-none
            font-sans
            prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-ovo-text
            prose-h1:text-[2em] prose-h1:mt-2 prose-h1:mb-4 prose-h1:leading-tight
            prose-h2:text-[1.5em] prose-h2:mt-8 prose-h2:mb-3 prose-h2:leading-snug
            prose-h3:text-[1.2em] prose-h3:mt-6 prose-h3:mb-2
            prose-h4:text-[1.05em] prose-h4:mt-5 prose-h4:mb-1 prose-h4:text-ovo-muted prose-h4:uppercase prose-h4:tracking-wider prose-h4:text-[12px]
            prose-p:my-4 prose-p:text-ovo-text/90
            prose-a:text-ovo-accent prose-a:no-underline prose-a:border-b prose-a:border-ovo-accent/40 hover:prose-a:border-ovo-accent prose-a:transition-colors
            prose-strong:text-ovo-text prose-strong:font-semibold
            prose-em:text-ovo-text prose-em:italic
            prose-code:font-mono prose-code:text-[0.88em] prose-code:text-ovo-accent prose-code:bg-ovo-chip/60 prose-code:px-[0.4em] prose-code:py-[0.15em] prose-code:rounded prose-code:before:content-none prose-code:after:content-none
            prose-pre:bg-ovo-surface-solid prose-pre:border prose-pre:border-ovo-border prose-pre:rounded-lg prose-pre:my-5 prose-pre:p-4 prose-pre:text-[13px] prose-pre:leading-relaxed
            prose-pre:shadow-sm
            prose-blockquote:border-l-2 prose-blockquote:border-l-ovo-accent prose-blockquote:pl-4 prose-blockquote:py-1 prose-blockquote:text-ovo-muted prose-blockquote:not-italic prose-blockquote:bg-ovo-accent/[0.03] prose-blockquote:rounded-r
            prose-hr:border-ovo-border prose-hr:my-8
            prose-ul:my-4 prose-ol:my-4 prose-li:my-1 prose-li:text-ovo-text/90
            prose-table:text-[13px] prose-table:my-5
            prose-thead:border-b-2 prose-thead:border-ovo-border
            prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-th:text-ovo-text
            prose-td:px-3 prose-td:py-2 prose-td:border-t prose-td:border-ovo-border/50
            prose-img:rounded-lg prose-img:shadow-md prose-img:my-6
          "
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
          >
            {doc}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
// [END] Phase 5
