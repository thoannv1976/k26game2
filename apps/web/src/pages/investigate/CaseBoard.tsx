import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { EVIDENCE_CATEGORIES, type EvidenceCategory } from '@ed/shared';
import { api } from '../../api/client';
import type { InvEvidence, InvLink, SessionPayload } from '../../api/types';
import { errorMessage } from '../../i18n/errors';
import { Badge, Button, Card, EmptyState, Field, Select, Textarea, cx } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useWorkspace } from './session';

type Column = EvidenceCategory | 'unsorted';
const COLUMNS: Column[] = ['unsorted', ...EVIDENCE_CATEGORIES];
type Items = Record<string, { category: EvidenceCategory | null; note: string }>;

const COLUMN_STYLE: Record<Column, string> = {
  unsorted: 'border-dashed border-line bg-surface-2/60',
  verified: 'border-success/40 bg-success-soft/50',
  unverified: 'border-warn/40 bg-warn-soft/50',
  irrelevant: 'border-line bg-surface-2',
};

function itemsFrom(evidence: InvEvidence[]): Items {
  return Object.fromEntries(evidence.map((e) => [e.id, { category: e.category, note: e.note }]));
}

/** Board state with debounced autosave (PUT /board) and an explicit save. */
function useBoard() {
  const { sid, data, readOnly, apply } = useWorkspace();
  const inv = data.investigation;
  const [items, setItems] = useState<Items>(() => itemsFrom(inv.evidence));
  const [links, setLinks] = useState<InvLink[]>(() => inv.links);
  const [dirty, setDirty] = useState(false);
  const latest = useRef({ items, links, dirty });
  latest.current = { items, links, dirty };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // New evidence collected elsewhere (Document Room) → add it to the board as unsorted.
  useEffect(() => {
    setItems((cur) => {
      const missing = inv.evidence.filter((e) => !cur[e.id]);
      if (!missing.length) return cur;
      return { ...cur, ...itemsFrom(missing) };
    });
  }, [inv.evidence]);

  const save = useMutation({
    mutationFn: (body: { items: Items; links: InvLink[] }) => api.put<SessionPayload>(`/api/sessions/${sid}/board`, body),
    onSuccess: (r, body) => {
      apply(r);
      if (latest.current.items === body.items && latest.current.links === body.links) setDirty(false);
    },
  });

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { items: i, links: l, dirty: d } = latest.current;
    if (!d || readOnly) return Promise.resolve();
    return save.mutateAsync({ items: i, links: l }).then(() => undefined);
  }, [readOnly, save]);

  const touch = useCallback(() => {
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush().catch(() => undefined), 2000);
  }, [flush]);

  useEffect(
    () => () => {
      // Save pending changes when leaving the board.
      if (timer.current) clearTimeout(timer.current);
      const { items: i, links: l, dirty: d } = latest.current;
      if (d && !readOnly) void api.put<SessionPayload>(`/api/sessions/${sid}/board`, { items: i, links: l }).then(apply).catch(() => undefined);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const move = (id: string, col: Column) => {
    setItems((cur) => ({ ...cur, [id]: { note: cur[id]?.note ?? '', category: col === 'unsorted' ? null : col } }));
    touch();
  };
  const setNote = (id: string, note: string) => {
    setItems((cur) => ({ ...cur, [id]: { category: cur[id]?.category ?? null, note } }));
    touch();
  };
  const addLink = (a: string, b: string, note: string) => {
    if (a === b) return;
    const key = [a, b].sort().join('|');
    setLinks((cur) => (cur.some((l) => [l.a, l.b].sort().join('|') === key) ? cur : [...cur, { a, b, note }]));
    touch();
  };
  const removeLink = (idx: number) => {
    setLinks((cur) => cur.filter((_, i) => i !== idx));
    touch();
  };
  return { items, links, dirty, save, flush, move, setNote, addLink, removeLink };
}

function EvidenceCard({
  e,
  item,
  others,
  readOnly,
  onMove,
  onNote,
  onLink,
  registerRef,
}: {
  e: InvEvidence;
  item: Items[string];
  others: InvEvidence[];
  readOnly: boolean;
  onMove: (c: Column) => void;
  onNote: (n: string) => void;
  onLink: (target: string, note: string) => void;
  registerRef: (el: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const { data, goTo } = useWorkspace();
  const [linking, setLinking] = useState(false);
  const [target, setTarget] = useState('');
  const [linkNote, setLinkNote] = useState('');
  const doc = data.investigation.documents.find((d) => d.id === e.documentId);
  const onDragStart = (ev: DragEvent) => {
    ev.dataTransfer.setData('text/evidence-id', e.id);
    ev.dataTransfer.effectAllowed = 'move';
  };
  return (
    <article
      ref={registerRef}
      data-testid={`evidence-card-${e.id}`}
      draggable={!readOnly}
      onDragStart={onDragStart}
      className="relative space-y-2 rounded-xl border border-line bg-paper p-3 shadow-sm"
    >
      <span className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-string shadow" aria-hidden="true" />
      <h4 className="pr-1 text-sm font-semibold" lang="en">
        {e.label}
      </h4>
      <blockquote className="border-l-2 border-mark pl-2 font-serif text-sm text-muted italic" lang="en">
        “{e.text}”
      </blockquote>
      {doc && (
        <button type="button" className="block text-left text-xs font-medium text-primary hover:underline" onClick={() => goTo('documents', doc.id)} lang="en">
          {t('board.source', { doc: doc.title })}
        </button>
      )}
      {readOnly && !item.note ? null : (
      <Textarea
        aria-label={`${t('board.note')} – ${e.label}`}
        placeholder={t('board.notePlaceholder')}
        className="min-h-16 text-sm"
        rows={2}
        maxLength={600}
        lang="en"
        value={item.note}
        disabled={readOnly}
        onChange={(ev) => onNote(ev.target.value)}
      />
      )}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Select data-testid={`move-${e.id}`} aria-label={`${t('board.moveTo')} – ${e.label}`} className="min-h-10 flex-1 py-1 text-sm" value={item.category ?? 'unsorted'} onChange={(ev) => onMove(ev.target.value as Column)}>
            {COLUMNS.map((c) => (
              <option key={c} value={c}>
                {t(`board.columns.${c}`)}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="secondary" aria-expanded={linking} onClick={() => setLinking((v) => !v)} disabled={others.length === 0}>
            🧵 {t('board.linkWith')}
          </Button>
        </div>
      )}
      {linking && (
        <div className="space-y-2 rounded-lg bg-surface-2 p-2">
          <Select aria-label={t('board.linkPick')} className="min-h-10 py-1 text-sm" value={target} onChange={(ev) => setTarget(ev.target.value)}>
            <option value="">{t('board.linkPick')}</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
          <input
            className="min-h-10 w-full rounded-lg border border-line bg-surface px-2 text-sm"
            aria-label={t('board.linkNote')}
            placeholder={t('board.linkNote')}
            maxLength={300}
            value={linkNote}
            lang="en"
            onChange={(ev) => setLinkNote(ev.target.value)}
          />
          <Button
            size="sm"
            disabled={!target}
            onClick={() => {
              onLink(target, linkNote.trim());
              setLinking(false);
              setTarget('');
              setLinkNote('');
            }}
          >
            {t('board.addLink')}
          </Button>
        </div>
      )}
    </article>
  );
}

/** Red strings between linked cards (desktop only; the link list below is the accessible version). */
function Strings({ container, cards, links }: { container: React.RefObject<HTMLDivElement | null>; cards: React.RefObject<Map<string, HTMLElement>>; links: InvLink[] }) {
  const [geo, setGeo] = useState<{ w: number; h: number; lines: { x1: number; y1: number; x2: number; y2: number }[] }>({ w: 0, h: 0, lines: [] });
  const last = useRef('');
  const measure = useCallback(() => {
    const box = container.current?.getBoundingClientRect();
    if (!box) return;
    const pt = (id: string) => {
      const r = cards.current.get(id)?.getBoundingClientRect();
      return r ? { x: Math.round(r.left + r.width / 2 - box.left), y: Math.round(r.top + 4 - box.top) } : null;
    };
    const lines = links
      .map((l) => {
        const a = pt(l.a);
        const b = pt(l.b);
        return a && b ? { x1: a.x, y1: a.y, x2: b.x, y2: b.y } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const next = { w: Math.round(box.width), h: Math.round(box.height), lines };
    const key = JSON.stringify(next);
    // Only update when the geometry really changed (avoids a render loop).
    if (key !== last.current) {
      last.current = key;
      setGeo(next);
    }
  }, [container, cards, links]);
  useLayoutEffect(() => {
    measure();
  });
  useEffect(() => {
    const el = container.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [container, measure]);
  if (!geo.lines.length) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 z-0 hidden lg:block" width={geo.w} height={geo.h} aria-hidden="true">
      {geo.lines.map((l, i) => {
        const sag = Math.min(60, Math.abs(l.x2 - l.x1) / 4 + 20);
        return <path key={i} d={`M${l.x1},${l.y1} Q${(l.x1 + l.x2) / 2},${Math.max(l.y1, l.y2) + sag} ${l.x2},${l.y2}`} fill="none" stroke="var(--ed-string)" strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />;
      })}
    </svg>
  );
}

function ConclusionPanel() {
  const { t } = useTranslation();
  const { sid, data, readOnly, apply } = useWorkspace();
  const toast = useToast();
  const c = data.investigation.conclusion;
  const evidence = data.investigation.evidence;
  const [optionId, setOptionId] = useState(c.selected?.optionId ?? '');
  const [support, setSupport] = useState<string[]>(c.selected?.supportingEvidenceIds ?? []);
  const [justification, setJustification] = useState(c.selected?.justification ?? '');
  const save = useMutation({
    mutationFn: () => api.post<SessionPayload>(`/api/sessions/${sid}/conclusion`, { optionId, supportingEvidenceIds: support, justification: justification.trim() }),
    onSuccess: (r) => {
      apply(r);
      toast.success(t('board.conclusionSaved'));
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const valid = optionId && support.length >= Math.min(c.minSupporting, Math.max(1, evidence.length)) && support.length >= 1 && justification.trim().length >= 10;
  const toggle = (id: string) => setSupport((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold">⚖️ {t('board.conclusion')}</h3>
        {c.selected && <Badge tone="success">✓ {t('board.current')}</Badge>}
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-2 font-semibold" lang="en">
          {c.question}
        </legend>
        {c.options.map((o) => (
          <label key={o.id} className={cx('flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2', optionId === o.id ? 'border-primary bg-primary-soft' : 'border-line')}>
            <input data-testid={`conclusion-option-${o.id}`} type="radio" name="conclusion" className="mt-1 h-4 w-4 accent-[var(--ed-primary)]" checked={optionId === o.id} disabled={readOnly} onChange={() => setOptionId(o.id)} />
            <span lang="en">{o.text}</span>
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">
          {t('board.support', { count: c.minSupporting })} · <span className="text-muted">{t('board.supportCount', { count: support.length })}</span>
        </legend>
        {evidence.length === 0 ? (
          <p className="text-sm text-muted">{t('board.needEvidence')}</p>
        ) : (
          <ul className="grid gap-1 sm:grid-cols-2">
            {evidence.map((e) => (
              <li key={e.id}>
                <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                  <input data-testid={`support-${e.id}`} type="checkbox" className="mt-0.5 h-5 w-5 accent-[var(--ed-primary)]" checked={support.includes(e.id)} disabled={readOnly} onChange={() => toggle(e.id)} />
                  <span lang="en">{e.label}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      <Field label={t('board.justification')} hint={t('board.justificationHint')}>
        {(id) => <Textarea id={id} data-testid="conclusion-justification" rows={4} maxLength={1500} lang="en" value={justification} disabled={readOnly} onChange={(e) => setJustification(e.target.value)} />}
      </Field>
      {!readOnly && (
        <Button data-testid="conclusion-save" onClick={() => save.mutate()} loading={save.isPending} disabled={!valid}>
          {t('board.saveConclusion')}
        </Button>
      )}
    </Card>
  );
}

export function CaseBoard() {
  const { t } = useTranslation();
  const { sid, data, readOnly, apply } = useWorkspace();
  const toast = useToast();
  const inv = data.investigation;
  const board = useBoard();
  const [over, setOver] = useState<Column | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const label = (id: string) => inv.evidence.find((e) => e.id === id)?.label ?? id;

  const removeClue = useMutation({
    mutationFn: (clueId: string) => api.delete<SessionPayload>(`/api/sessions/${sid}/clues/${clueId}`),
    onSuccess: apply,
    onError: (e) => toast.error(errorMessage(t, e)),
  });

  const onDrop = (col: Column) => (ev: DragEvent) => {
    ev.preventDefault();
    setOver(null);
    const id = ev.dataTransfer.getData('text/evidence-id');
    if (id) board.move(id, col);
  };

  const explicitSave = () =>
    board
      .flush()
      .then(() => toast.success(t('board.saved')))
      .catch((e) => toast.error(errorMessage(t, e)));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{t('board.title')}</h2>
          <p className="max-w-3xl text-sm text-muted">{t('board.intro')}</p>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted" role="status">
              {board.save.isPending ? t('common.saving') : board.dirty ? t('board.unsaved') : t('board.autosaved')}
            </span>
            <Button data-testid="board-save" onClick={() => void explicitSave()} loading={board.save.isPending} variant={board.dirty ? 'primary' : 'secondary'}>
              💾 {t('board.save')}
            </Button>
          </div>
        )}
      </div>
      {board.save.isError && <p className="text-sm text-danger">{errorMessage(t, board.save.error)}</p>}

      {inv.evidence.length === 0 ? (
        <EmptyState icon="📌" title={t('board.empty')} />
      ) : (
        <div ref={container} className="cork relative rounded-2xl p-3 shadow-inner sm:p-4">
          <Strings container={container} cards={cardRefs} links={board.links} />
          <div className="relative z-[1] grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {COLUMNS.map((col) => {
              const inCol = inv.evidence.filter((e) => (board.items[e.id]?.category ?? 'unsorted') === col);
              return (
                <section
                  key={col}
                  aria-label={t(`board.columns.${col}`)}
                  data-column={col}
                  onDragOver={(ev) => {
                    if (readOnly) return;
                    ev.preventDefault();
                    setOver(col);
                  }}
                  onDragLeave={() => setOver((o) => (o === col ? null : o))}
                  onDrop={onDrop(col)}
                  className={cx('min-h-40 rounded-xl border-2 p-2', COLUMN_STYLE[col], over === col && 'ring-4 ring-primary/40')}
                >
                  <header className="mb-2 px-1">
                    <h3 className="flex items-center justify-between text-sm font-bold">
                      {t(`board.columns.${col}`)} <Badge>{inCol.length}</Badge>
                    </h3>
                    <p className="text-xs text-muted">{t(`board.columnHint.${col}`)}</p>
                  </header>
                  <div className="space-y-4 pt-1">
                    {inCol.map((e) => (
                      <EvidenceCard
                        key={e.id}
                        e={e}
                        item={board.items[e.id] ?? { category: null, note: '' }}
                        others={inv.evidence.filter((o) => o.id !== e.id)}
                        readOnly={readOnly}
                        onMove={(c) => board.move(e.id, c)}
                        onNote={(n) => board.setNote(e.id, n)}
                        onLink={(target, note) => board.addLink(e.id, target, note)}
                        registerRef={(el) => {
                          if (el) cardRefs.current.set(e.id, el);
                          else cardRefs.current.delete(e.id);
                        }}
                      />
                    ))}
                    {inCol.length === 0 && <p className="rounded-lg border border-dashed border-line/80 px-2 py-6 text-center text-xs text-muted">{t('board.drop')}</p>}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h3 className="mb-2 font-bold">🧵 {t('board.links')}</h3>
          {board.links.length === 0 ? (
            <p className="text-sm text-muted">{t('board.noLinks')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {board.links.map((l, i) => (
                <li key={`${l.a}-${l.b}`} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0" lang="en">
                    <span className="font-medium">{label(l.a)}</span> <span className="text-string">⟷</span> <span className="font-medium">{label(l.b)}</span>
                    {l.note && <span className="block text-xs text-muted">{l.note}</span>}
                  </span>
                  {!readOnly && (
                    <Button size="sm" variant="ghost" className="text-danger" aria-label={`${t('board.removeLink')}: ${label(l.a)} – ${label(l.b)}`} onClick={() => board.removeLink(i)}>
                      ✕
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h3 className="font-bold">🗒️ {t('board.clues')}</h3>
          <p className="mb-2 text-xs text-muted">{t('board.cluesHint')}</p>
          {inv.clues.length === 0 ? (
            <p className="text-sm text-muted">{t('board.noClues')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {inv.clues.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0" lang="en">
                    “{c.text}”<span className="block text-xs text-muted">{inv.documents.find((d) => d.id === c.documentId)?.title}</span>
                  </span>
                  {!readOnly && (
                    <Button size="sm" variant="ghost" className="text-danger" aria-label={t('board.removeClue')} onClick={() => removeClue.mutate(c.id)} loading={removeClue.isPending && removeClue.variables === c.id}>
                      ✕
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <ConclusionPanel />
    </div>
  );
}
