// Building blocks shared by the student-space pages.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { inputClass } from "./studentStyles";

export function StudentPage({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="pt-28 pb-24 px-5 sm:pt-32 sm:px-6 lg:px-12">
      <div className={`${wide ? "max-w-4xl" : "max-w-2xl"} mx-auto`}>{children}</div>
    </div>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="mb-8 inline-flex items-center gap-2 text-sm font-medium" style={{ color: "#305D55" }}>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {children}
    </Link>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 font-heading text-sm font-bold" style={{ color: "#F28A4B" }}>
      {children}
    </p>
  );
}

export function Notice({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  const style =
    tone === "error"
      ? { background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C" }
      : tone === "success"
        ? { background: "#E3EDE7", border: "1px solid #C9DCD1", color: "#1F3B36" }
        : { background: "#FBF6EE", border: "1px solid #ECE5D9", color: "#4B5B58" };
  return (
    <div role={tone === "error" ? "alert" : "status"} className="rounded-md p-3 text-sm leading-relaxed" style={style}>
      {children}
    </div>
  );
}

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  hint,
  showLabel,
  hideLabel,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  hint?: string;
  showLabel: string;
  hideLabel: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium" style={{ color: "#1F3B36" }}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          className={`${inputClass} pr-11`}
          style={{ borderColor: "#DDD5C7", color: "#1F3B36" }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5"
          aria-label={visible ? hideLabel : showLabel}
          style={{ color: "#6B7672" }}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs" style={{ color: "#6B7672" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

const PLACEHOLDER = /^\[[^\]]+\]$/;

function textOf(children: ReactNode): string | null {
  if (typeof children === "string") return children;
  if (Array.isArray(children) && children.length === 1 && typeof children[0] === "string") return children[0];
  return null;
}

/** The part of a Markdown syntax-tree node (hast) that columnCount reads. */
type MarkdownNode = { type: string; tagName?: string; children?: MarkdownNode[] };

/** Number of columns of a Markdown table: the cells of its first row. */
function columnCount(node: MarkdownNode | undefined): number {
  const queue = node ? [node] : [];
  for (let n = queue.shift(); n; n = queue.shift()) {
    if (n.tagName === "tr") return (n.children ?? []).filter((c) => c.tagName === "th" || c.tagName === "td").length;
    queue.push(...(n.children ?? []));
  }
  return 0;
}

const BORDER = "#ECE5D9";

/** Module content (markdown). A paragraph like "[MODULE 1 CONTENT TO BE PROVIDED]" is shown as an unfinished placeholder. */
export function ModuleBody({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => {
          const text = textOf(children);
          if (text && PLACEHOLDER.test(text.trim())) {
            return (
              <p
                className="my-5 rounded-sm border border-dashed border-amber-500 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800"
                title="This content still needs to be provided"
              >
                {text}
              </p>
            );
          }
          return (
            <p className="my-4 text-base leading-relaxed" style={{ color: "#4B5B58" }}>
              {children}
            </p>
          );
        },
        h2: ({ children }) => (
          <h2 className="mt-10 mb-3 font-heading text-xl font-bold" style={{ color: "#1F3B36" }}>
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="mt-8 mb-2 font-heading text-lg font-bold" style={{ color: "#1F3B36" }}>
            {children}
          </h3>
        ),
        ul: ({ children }) => (
          <ul className="my-4 list-disc space-y-2 pl-5 text-base leading-relaxed" style={{ color: "#4B5B58" }}>
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="my-4 list-decimal space-y-2 pl-5 text-base leading-relaxed" style={{ color: "#4B5B58" }}>
            {children}
          </ol>
        ),
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "#305D55" }}>
            {children}
          </a>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold" style={{ color: "#1F3B36" }}>
            {children}
          </strong>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-5 border-l-4 pl-4 italic" style={{ borderColor: "#F28A4B", color: "#4B5B58" }}>
            {children}
          </blockquote>
        ),
        h4: ({ children }) => (
          <h4 className="mt-6 mb-2 font-heading text-base font-bold" style={{ color: "#1F3B36" }}>
            {children}
          </h4>
        ),
        hr: () => <hr className="my-8 border-t" style={{ borderColor: "#ECE5D9" }} />,
        // Code blocks (templates to copy): long lines wrap; a word too long to wrap (a link) scrolls inside the block.
        pre: ({ children }) => (
          <pre
            className="my-5 overflow-x-auto whitespace-pre-wrap rounded-md border px-4 py-3 text-sm leading-relaxed"
            style={{ background: "#F5EFE5", borderColor: BORDER, color: "#1F3B36" }}
          >
            {children}
          </pre>
        ),
        // Code blocks (inside <pre>) end with a newline or carry a language class; inline code gets the pill style.
        code: ({ className, children }) =>
          className || /\n$/.test(String(children)) ? (
            <code className={className}>{children}</code>
          ) : (
            <code className="rounded px-1 py-0.5 text-[0.9em]" style={{ background: "#F5EFE5", color: "#1F3B36" }}>
              {children}
            </code>
          ),
        // Tables sit in a bordered frame that scrolls sideways when needed; from 4 columns up they keep a minimum width,
        // so that on a phone they scroll instead of squeezing every column (at most 40rem: no scroll on a computer).
        table: ({ node, children }) => {
          const columns = columnCount(node);
          return (
            <div className="my-5 overflow-x-auto rounded-md border" style={{ borderColor: BORDER }}>
              <table
                className="w-full border-collapse text-left text-sm leading-relaxed"
                style={{ color: "#4B5B58", minWidth: columns >= 4 ? `${Math.min(columns * 8.5, 40)}rem` : undefined }}
              >
                {children}
              </table>
            </div>
          );
        },
        thead: ({ children }) => <thead style={{ background: "#FBF6EE" }}>{children}</thead>,
        th: ({ children, style }) => (
          <th
            className="border-b border-l px-3 py-2.5 align-bottom font-semibold first:border-l-0"
            style={{ ...style, borderColor: BORDER, color: "#1F3B36" }}
          >
            {children}
          </th>
        ),
        td: ({ children, style }) => (
          <td className="border-l border-t px-3 py-2.5 align-top first:border-l-0" style={{ ...style, borderColor: BORDER }}>
            {children}
          </td>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}
