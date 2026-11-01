import { forwardRef, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { parseBlocks, segmentText, type DocBlock } from '../lib/text';
import { cx } from './ui';

export interface ViewDoc {
  type: string;
  title: string;
  meta: Record<string, string>;
  body: string;
  glossary: { term: string; definition: string; vi: string }[];
}

function GlossaryTerm({ text, entry }: { text: string; entry: ViewDoc['glossary'][number] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline">
      <span
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className="gloss-term"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        {text}
      </span>
      {open && (
        <span id={id} role="note" className="absolute top-full left-1/2 z-30 mt-2 block w-64 max-w-[78vw] -translate-x-1/2 rounded-xl border border-line bg-surface p-3 text-left font-sans text-sm leading-snug shadow-lg select-none">
          <span className="block font-semibold">{entry.term}</span>
          <span className="mt-1 block" lang="en">
            {entry.definition}
          </span>
          <span className="mt-1 block text-muted" lang="vi">
            🇻🇳 {entry.vi}
          </span>
          <span className="sr-only">{t('docs.vi')}</span>
        </span>
      )}
    </span>
  );
}

function RichText({ text, marks, glossary, interactive }: { text: string; marks: string[]; glossary: ViewDoc['glossary']; interactive: boolean }) {
  const segs = segmentText(
    text,
    marks,
    glossary.map((g) => g.term),
  );
  return (
    <>
      {segs.map((s, i) =>
        s.mark ? (
          <mark key={i} className="doc-mark">
            {s.text}
          </mark>
        ) : s.term !== undefined && interactive ? (
          <GlossaryTerm key={i} text={s.text} entry={glossary[s.term]!} />
        ) : s.term !== undefined ? (
          <span key={i} className="gloss-term" title={`${glossary[s.term]!.definition} – ${glossary[s.term]!.vi}`}>
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

function Blocks({ blocks, marks, glossary, interactive, chat }: { blocks: DocBlock[]; marks: string[]; glossary: ViewDoc['glossary']; interactive: boolean; chat: boolean }) {
  const rt = (text: string) => <RichText text={text} marks={marks} glossary={glossary} interactive={interactive} />;
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === 'table')
          return (
            <div key={i} className="-mx-1 my-4 overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse font-sans text-sm">
                <thead>
                  <tr>
                    {b.table.header.map((h, j) => (
                      <th key={j} scope="col" className="border border-line bg-surface-2 px-2 py-1.5 text-left font-semibold">
                        {rt(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.table.rows.map((r, j) => (
                    <tr key={j}>
                      {r.map((c, k) => (
                        <td key={k} className="border border-line px-2 py-1.5 align-top">
                          {rt(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        if (b.kind === 'list') {
          const L = b.ordered ? 'ol' : 'ul';
          return (
            <L key={i} className={cx('my-3 space-y-1 pl-6', b.ordered ? 'list-decimal' : 'list-disc')}>
              {b.items.map((it, j) => (
                <li key={j}>{rt(it)}</li>
              ))}
            </L>
          );
        }
        if (chat) {
          return (
            <div key={i} className="my-2 space-y-2">
              {b.lines.map((l, j) => {
                const m = /^([^:]{1,40}):\s(.*)$/.exec(l);
                return (
                  <p key={j} className="w-fit max-w-[92%] rounded-2xl rounded-tl-sm bg-surface-2 px-3 py-2">
                    {m ? (
                      <>
                        <span className="block text-xs font-bold text-primary">{rt(m[1]!)}</span>
                        {rt(m[2]!)}
                      </>
                    ) : (
                      rt(l)
                    )}
                  </p>
                );
              })}
            </div>
          );
        }
        return (
          <p key={i} className="my-3">
            {b.lines.map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {rt(l)}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

function MetaTable({ meta, className }: { meta: Record<string, string>; className?: string }) {
  const entries = Object.entries(meta);
  if (!entries.length) return null;
  return (
    <dl className={cx('grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm', className)}>
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-semibold text-muted">{k}:</dt>
          <dd className="break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const TYPE_ICON: Record<string, string> = {
  email: '✉️',
  notice: '📢',
  webpage: '🌐',
  letter: '📨',
  report: '📋',
  chat: '💬',
  contract: '📜',
  table: '📊',
  news: '📰',
  receipt: '🧾',
  memo: '🗒️',
  form: '📝',
  review: '⭐',
};
export const docIcon = (type: string) => TYPE_ICON[type] ?? '📄';

/**
 * Renders a case document according to its type: email (header table), webpage (browser frame), chat (bubbles),
 * receipt (narrow monospace) and paper style for notices, reports, contracts, forms… Tables are Markdown pipe rows.
 * `marks` are evidence texts highlighted in yellow. The body element (data-testid="doc-body") is forwarded via ref.
 */
export const DocumentView = forwardRef<HTMLDivElement, { doc: ViewDoc; marks?: string[]; interactive?: boolean; bodyOverride?: ReactNode; testId?: string }>(function DocumentView(
  { doc, marks = [], interactive = true, bodyOverride, testId = 'doc-body' },
  ref,
) {
  const { t } = useTranslation();
  const blocks = parseBlocks(doc.body);
  const body = bodyOverride ?? <Blocks blocks={blocks} marks={marks} glossary={doc.glossary} interactive={interactive} chat={doc.type === 'chat'} />;
  const bodyEl = (cls: string) => (
    <div ref={ref} data-testid={testId} className={cx('leading-relaxed', cls)} lang="en">
      {body}
    </div>
  );

  if (doc.type === 'email') {
    const subject = doc.meta.Subject ?? doc.title;
    const meta = Object.fromEntries(Object.entries(doc.meta).filter(([k]) => k !== 'Subject'));
    return (
      <article className="overflow-hidden rounded-2xl border border-line bg-paper shadow-sm">
        <header className="space-y-2 border-b border-line bg-surface-2 px-4 py-3 sm:px-6">
          <h3 className="flex items-start gap-2 text-lg font-semibold" lang="en">
            <span aria-hidden="true">✉️</span>
            <span>{subject}</span>
          </h3>
          <MetaTable meta={meta} />
        </header>
        {bodyEl('px-4 py-2 sm:px-6')}
      </article>
    );
  }

  if (doc.type === 'webpage' || doc.type === 'review') {
    const url = doc.meta.URL ?? doc.meta.Page ?? doc.meta.Platform ?? '';
    const meta = Object.fromEntries(Object.entries(doc.meta).filter(([k]) => k !== 'URL'));
    return (
      <article className="overflow-hidden rounded-2xl border border-line bg-paper shadow-sm">
        <header className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="h-3 w-3 rounded-full bg-[#e06c5b]" />
            <span className="h-3 w-3 rounded-full bg-[#e8c35a]" />
            <span className="h-3 w-3 rounded-full bg-[#6cbf73]" />
          </span>
          <div className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface px-3 py-1 font-mono text-xs" aria-label={t('docs.browserBar')} title={url}>
            🔒 {url}
          </div>
        </header>
        <div className="px-4 pt-4 sm:px-6">
          <h3 className="text-xl font-bold" lang="en">
            {doc.title}
          </h3>
          <MetaTable meta={meta} className="mt-2 text-xs" />
        </div>
        {bodyEl('px-4 pb-4 sm:px-6')}
      </article>
    );
  }

  const narrow = doc.type === 'receipt';
  return (
    <article className={cx('paper-plain rounded-md border border-line', narrow ? 'mx-auto max-w-md font-mono text-sm' : 'font-serif')}>
      <header className="border-b-2 border-double border-line px-4 pt-5 pb-3 sm:px-8">
        <div className="mb-1 font-mono text-[11px] font-bold tracking-[0.2em] text-muted uppercase">
          {docIcon(doc.type)} {doc.type}
        </div>
        <h3 className="text-xl font-bold" lang="en">
          {doc.title}
        </h3>
        <MetaTable meta={doc.meta} className="mt-2 font-sans" />
      </header>
      {bodyEl(cx('px-4 pb-5 sm:px-8', doc.type === 'chat' && 'font-sans'))}
    </article>
  );
});
