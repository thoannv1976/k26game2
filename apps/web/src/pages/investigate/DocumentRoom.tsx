import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { HighlightResponse, InvDocument, SessionPayload } from '../../api/types';
import { errorMessage } from '../../i18n/errors';
import { splitSentences } from '../../lib/text';
import { DocumentView, docIcon } from '../../components/DocumentView';
import { Badge, Button, EmptyState, cx } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useWorkspace } from './session';

/** Contiguous range selection over sentence chips. */
export function toggleRange(sel: [number, number] | null, i: number): [number, number] | null {
  if (!sel) return [i, i];
  const [a, b] = sel;
  if (i === a && i === b) return null;
  if (i === a - 1) return [i, b];
  if (i === b + 1) return [a, i];
  if (i === a) return [a + 1, b];
  if (i === b) return [a, b - 1];
  return [i, i];
}

function useHighlight() {
  const { t } = useTranslation();
  const { sid, apply } = useWorkspace();
  const toast = useToast();
  return useMutation({
    mutationFn: (v: { documentId: string; text: string }) => api.post<HighlightResponse>(`/api/sessions/${sid}/highlights`, v),
    onSuccess: (r) => {
      apply(r);
      const res = r.result;
      if (res.kind === 'evidence') {
        if (res.isNew) toast.success(`📌 ${t('inv.newEvidence', { label: res.label ?? '' })}`);
        else toast.show(t('inv.alreadyEvidence', { label: res.label ?? '' }));
      } else if (res.isNew) toast.show(`🗒️ ${t('inv.clueSaved')}`);
      else toast.show(t('inv.clueExists'));
      window.getSelection()?.removeAllRanges();
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
}

function DocList({ docs, current, onPick, evidenceCount }: { docs: InvDocument[]; current: string | null; onPick: (d: InvDocument) => void; evidenceCount: (id: string) => number }) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-1.5" aria-label={t('docs.list')}>
      {docs.map((d) => {
        const n = evidenceCount(d.id);
        return (
          <li key={d.id}>
            <button
              type="button"
              data-testid={`doc-item-${d.id}`}
              data-locked={d.locked ? 'true' : 'false'}
              aria-current={current === d.id ? 'true' : undefined}
              onClick={() => onPick(d)}
              className={cx(
                'flex min-h-12 w-full items-start gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors',
                current === d.id ? 'border-primary bg-primary-soft' : 'border-line bg-surface hover:border-primary/60',
                d.locked && 'border-dashed opacity-75',
              )}
            >
              <span aria-hidden="true" className="mt-0.5 text-base">
                {d.locked ? '🔒' : docIcon(d.type)}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cx('block leading-snug font-medium', d.locked && 'text-muted italic')} lang={d.locked ? undefined : 'en'}>
                  {d.locked ? t('docs.lockedTitle') : d.title}
                </span>
                <span className="mt-0.5 flex flex-wrap gap-1 text-xs text-muted">
                  {d.locked ? t('docs.locked') : <span className="capitalize">{d.type}</span>}
                  {!d.locked && !d.opened && <Badge tone="warn">{t('docs.unread')}</Badge>}
                  {n > 0 && <Badge tone="success">📌 {n}</Badge>}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Floating "Save as evidence" button above the current text selection inside the document body. */
function SelectionButton({ bodyRef, onSave, busy }: { bodyRef: React.RefObject<HTMLDivElement | null>; onSave: (text: string) => void; busy: boolean }) {
  const { t } = useTranslation();
  const [pos, setPos] = useState<{ x: number; y: number; text: string } | null>(null);
  const update = useCallback(() => {
    const sel = window.getSelection();
    const body = bodyRef.current;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !body) return setPos(null);
    if (!body.contains(sel.anchorNode) || !body.contains(sel.focusNode)) return setPos(null);
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 3) return setPos(null);
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const x = Math.min(window.innerWidth - 130, Math.max(130, rect.left + rect.width / 2));
    const above = rect.top - 56;
    const y = above < 64 ? rect.bottom + 12 : above;
    // Keep the button on screen even when the selection is partly scrolled out of view.
    setPos({ x, y: Math.min(window.innerHeight - 64, Math.max(64, y)), text });
  }, [bodyRef]);
  useEffect(() => {
    document.addEventListener('selectionchange', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      document.removeEventListener('selectionchange', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [update]);
  if (!pos) return null;
  return (
    <Button
      data-testid="save-evidence"
      size="md"
      loading={busy}
      className="fixed z-40 -translate-x-1/2 shadow-lg ring-2 ring-surface"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onSave(pos.text)}
    >
      📌 {t('docs.saveEvidence')}
    </Button>
  );
}

function SentenceChips({ doc, marks, onSave, busy }: { doc: InvDocument; marks: string[]; onSave: (text: string) => void; busy: boolean }) {
  const { t } = useTranslation();
  const chips = useMemo(() => splitSentences(doc.body), [doc.body]);
  const [sel, setSel] = useState<[number, number] | null>(null);
  useEffect(() => setSel(null), [doc.id]);
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
  const collected = (c: string) => marks.some((m) => norm(c).includes(norm(m)) || norm(m).includes(norm(c)));
  const count = sel ? sel[1] - sel[0] + 1 : 0;
  const text = sel ? chips.slice(sel[0], sel[1] + 1).join(' ') : '';
  return (
    <div>
      <p className="mb-3 font-sans text-sm text-muted">{t('docs.selectHelp')}</p>
      <ul className="flex flex-wrap gap-2 font-sans">
        {chips.map((c, i) => {
          const on = sel !== null && i >= sel[0] && i <= sel[1];
          return (
            <li key={i} className="max-w-full">
              <button
                type="button"
                data-testid="sentence-chip"
                data-text={c}
                aria-pressed={on}
                onClick={() => setSel((s) => toggleRange(s, i))}
                className={cx(
                  'min-h-11 max-w-full rounded-xl border px-3 py-2 text-left text-sm leading-snug break-words transition-colors',
                  on ? 'border-primary bg-primary text-primary-fg' : collected(c) ? 'doc-mark border-transparent' : 'border-line bg-surface hover:border-primary',
                )}
              >
                {c}
              </button>
            </li>
          );
        })}
      </ul>
      {count > 0 && (
        <div className="sticky bottom-20 z-20 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-surface p-3 font-sans shadow-lg lg:bottom-4">
          <span className="text-sm font-semibold">{t('docs.selectedCount', { count })}</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSel(null)}>
              {t('docs.clearSelection')}
            </Button>
            <Button
              data-testid="save-evidence"
              size="sm"
              loading={busy}
              onClick={() => {
                onSave(text);
                setSel(null);
              }}
            >
              📌 {t('docs.saveEvidence')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DocumentRoom({ docId, onPickDoc }: { docId: string | null; onPickDoc: (id: string | null) => void }) {
  const { t } = useTranslation();
  const { sid, data, readOnly, apply } = useWorkspace();
  const toast = useToast();
  const inv = data.investigation;
  const docs = inv.documents;
  const current = docs.find((d) => d.id === docId && !d.locked) ?? null;
  const bodyRef = useRef<HTMLDivElement>(null);
  const [selectMode, setSelectMode] = useState(false);
  const highlight = useHighlight();
  const opening = useRef(new Set<string>());

  useEffect(() => {
    if (!current || current.opened || readOnly || opening.current.has(current.id)) return;
    opening.current.add(current.id);
    api
      .post<SessionPayload>(`/api/sessions/${sid}/documents/${current.id}/open`)
      .then(apply)
      .catch(() => opening.current.delete(current.id));
  }, [current, sid, readOnly, apply]);

  const marksFor = (id: string) => inv.evidence.filter((e) => e.documentId === id).map((e) => e.text);
  const save = (text: string) => current && !readOnly && highlight.mutate({ documentId: current.id, text });

  const pick = (d: InvDocument) => {
    if (d.locked) {
      toast.show(`🔒 ${t('docs.locked')}`);
      return;
    }
    onPickDoc(d.id);
  };

  return (
    <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
      <div className={cx(current && 'hidden md:block')}>
        <h2 className="mb-2 text-sm font-semibold text-muted">{t('docs.list')}</h2>
        <DocList docs={docs} current={current?.id ?? null} onPick={pick} evidenceCount={(id) => inv.evidence.filter((e) => e.documentId === id).length} />
      </div>
      <div className={cx('min-w-0', !current && 'hidden md:block')}>
        {!current ? (
          <EmptyState icon="🗄️" title={t('docs.pick')}>
            {t('docs.highlightHelp')}
          </EmptyState>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" size="sm" className="-ml-2 md:hidden" onClick={() => onPickDoc(null)}>
                ← {t('docs.backToList')}
              </Button>
              {!readOnly && (
                <Button data-testid="select-mode-toggle" variant={selectMode ? 'primary' : 'secondary'} size="sm" aria-pressed={selectMode} onClick={() => setSelectMode((v) => !v)}>
                  ☰ {selectMode ? t('docs.selectModeOn') : t('docs.selectMode')}
                </Button>
              )}
            </div>
            {!readOnly && !selectMode && <p className="text-xs text-muted">{t('docs.highlightHelp')}</p>}
            <DocumentView
              ref={bodyRef}
              doc={current}
              marks={marksFor(current.id)}
              bodyOverride={selectMode && !readOnly ? <SentenceChips doc={current} marks={marksFor(current.id)} onSave={save} busy={highlight.isPending} /> : undefined}
            />
            {current.glossary.length > 0 && (
              <details className="rounded-xl border border-line bg-surface p-3 text-sm">
                <summary className="cursor-pointer font-semibold">
                  📖 {t('docs.glossary')} ({current.glossary.length})
                </summary>
                <p className="mt-1 text-xs text-muted">{t('docs.glossaryHint')}</p>
                <dl className="mt-2 space-y-2">
                  {current.glossary.map((g) => (
                    <div key={g.term}>
                      <dt className="font-semibold" lang="en">
                        {g.term}
                      </dt>
                      <dd className="text-muted">
                        <span lang="en">{g.definition}</span> · <span lang="vi">{g.vi}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
            {!readOnly && !selectMode && <SelectionButton bodyRef={bodyRef} onSave={save} busy={highlight.isPending} />}
          </div>
        )}
      </div>
    </div>
  );
}
