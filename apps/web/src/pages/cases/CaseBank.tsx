import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LEVELS, type Level } from '@ed/shared';
import { api } from '../../api/client';
import type { AdminCaseDetail, AdminCaseRow, AdminCaseVersion, CaseDraftResult, DossierCheck } from '../../api/types';
import { useLocalized } from '../../i18n';
import { errorMessage, validationIssues } from '../../i18n/errors';
import { formatDate } from '../../lib/format';
import { Alert, Badge, Button, Card, ConfirmModal, EmptyState, ErrorBox, Field, Input, LevelBadge, Modal, PageSkeleton, SectionTitle, Select, Skeleton, Table, Textarea, cx } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { CasePreview } from './CasePreview';

const STATUS_TONE = { approved: 'success', draft: 'warn', archived: 'neutral', superseded: 'neutral' } as const;

function CheckSummary({ check }: { check: DossierCheck }) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-wrap gap-1">
      {check.ok ? <Badge tone="success">✓ {t('caseBank.checkOk')}</Badge> : <Badge tone="danger">✗ {t('caseBank.checkErrors', { count: check.errors.length })}</Badge>}
      {check.warnings.length > 0 && <Badge tone="warn">{t('caseBank.checkWarnings', { count: check.warnings.length })}</Badge>}
    </span>
  );
}

function CheckDetails({ check }: { check: DossierCheck }) {
  if (check.ok && !check.warnings.length) return null;
  return (
    <div className="space-y-2 text-xs">
      {check.errors.length > 0 && (
        <Alert tone="danger">
          <ul className="list-disc pl-4 font-mono">
            {check.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}
      {check.warnings.length > 0 && (
        <Alert tone="warn">
          <ul className="list-disc pl-4 font-mono">
            {check.warnings.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}

function CaseEditor({ id, canAdmin, onClose }: { id: string; canAdmin: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { lang } = useLocalized();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin-case', id], queryFn: () => api.get<AdminCaseDetail>(`/api/admin/cases/${id}`) });
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<'preview' | 'json'>('preview');
  const [json, setJson] = useState('');
  const [note, setNote] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<DossierCheck | null>(null);

  const version: AdminCaseVersion | undefined = q.data?.versions.find((v) => v.version === selected) ?? q.data?.versions[0];
  useEffect(() => {
    if (version) {
      setJson(JSON.stringify(version.dossier, null, 2));
      setParseError(null);
    }
  }, [version]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin-case', id] });
    void qc.invalidateQueries({ queryKey: ['admin-cases'] });
    void qc.invalidateQueries({ queryKey: ['cases'] });
  };
  const save = useMutation({
    mutationFn: (dossier: unknown) => api.put<CaseDraftResult>(`/api/admin/cases/${id}`, { dossier, note }),
    onSuccess: (r) => {
      toast.success(t('caseBank.savedDraft', { v: r.version }));
      setNote('');
      setSelected(r.version);
      setLastCheck(r.check);
      invalidate();
    },
  });
  const approve = useMutation({
    mutationFn: (v: number) => api.post<{ approvedVersion: number }>(`/api/admin/cases/${id}/approve`, { version: v }),
    onSuccess: (r) => {
      toast.success(t('caseBank.approved', { v: r.approvedVersion }));
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) => api.post<{ status: string }>(`/api/admin/cases/${id}/archive`, { archived }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });

  const onSave = () => {
    setParseError(null);
    let dossier: unknown;
    try {
      dossier = JSON.parse(json);
    } catch (e) {
      setParseError((e as Error).message);
      return;
    }
    save.mutate(dossier);
  };
  const format = () => {
    try {
      setJson(JSON.stringify(JSON.parse(json), null, 2));
      setParseError(null);
    } catch (e) {
      setParseError((e as Error).message);
    }
  };
  const issues = validationIssues(save.error);
  const doc = q.data?.case;

  return (
    <Modal open onClose={onClose} title={t('caseBank.caseTitle', { id })} size="xl">
      {q.isPending ? (
        <Skeleton className="h-96" />
      ) : q.isError ? (
        <ErrorBox error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[doc!.status]}>{t(`caseBank.status.${doc!.status}`)}</Badge>
              <span className="text-xs text-muted">{t('caseBank.approvedV', { v: doc!.approvedVersion || '—' })}</span>
            </div>
            {canAdmin && (
              <Button size="sm" variant="secondary" onClick={() => archive.mutate(doc!.status !== 'archived')} loading={archive.isPending}>
                {doc!.status === 'archived' ? t('caseBank.unarchive') : t('caseBank.archive')}
              </Button>
            )}
            <h3 className="pt-2 text-sm font-semibold">{t('caseBank.versions')}</h3>
            <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
              {q.data.versions.map((v) => (
                <li key={v.version} className={cx('rounded-xl border p-3 text-sm', version?.version === v.version ? 'border-primary bg-primary-soft/40' : 'border-line')}>
                  <button type="button" className="w-full text-left" onClick={() => setSelected(v.version)} aria-pressed={version?.version === v.version}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold">v{v.version}</span>
                      <Badge tone={STATUS_TONE[v.status]}>{t(`caseBank.status.${v.status}`)}</Badge>
                    </span>
                    <span className="mt-1 block text-xs text-muted">
                      {t(`caseBank.source.${v.source}`)} · {formatDate(v.createdAt, lang, true)}
                    </span>
                    {v.note && <span className="mt-1 block text-xs">{v.note}</span>}
                    {v.approvedAt && <span className="mt-1 block text-xs text-success">✓ {formatDate(v.approvedAt, lang, true)}</span>}
                  </button>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <CheckSummary check={v.check} />
                    {v.status !== 'approved' && (
                      <Button
                        size="sm"
                        variant="success"
                        data-testid={`case-approve-${v.version}`}
                        onClick={() => approve.mutate(v.version)}
                        loading={approve.isPending && approve.variables === v.version}
                        disabled={!v.check.ok}
                        title={!v.check.ok ? t('caseBank.approveDisabled') : undefined}
                      >
                        ✓ {t('caseBank.approve')}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0 space-y-3">
            {version && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex rounded-xl border border-line bg-surface p-0.5" role="group">
                    {(['preview', 'json'] as const).map((m) => (
                      <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={cx('min-h-10 rounded-lg px-3 text-sm font-semibold', mode === m ? 'bg-primary text-primary-fg' : 'text-muted')}>
                        {m === 'preview' ? t('caseBank.preview') : t('caseBank.json')}
                      </button>
                    ))}
                  </div>
                  <span className="text-sm font-semibold">{t('caseBank.version', { v: version.version })}</span>
                </div>
                <CheckDetails check={version.check} />
                {mode === 'preview' ? (
                  <CasePreview d={version.dossier} />
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">{t('caseBank.editingFrom', { v: version.version })}</h3>
                      <Button size="sm" variant="ghost" onClick={format}>
                        {t('caseBank.format')}
                      </Button>
                    </div>
                    <Textarea aria-label={t('caseBank.json')} className="min-h-[50vh] font-mono text-xs leading-relaxed" spellCheck={false} value={json} onChange={(e) => setJson(e.target.value)} />
                    {parseError && <Alert tone="danger">{t('caseBank.jsonError', { message: parseError })}</Alert>}
                    {save.isError && (
                      <Alert tone="danger">
                        <div className="font-semibold">{errorMessage(t, save.error)}</div>
                        {issues.length > 0 && (
                          <ul className="mt-1 list-disc pl-5 font-mono text-xs">
                            {issues.map((i, n) => (
                              <li key={n}>
                                {i.path || '(root)'}: {i.message}
                              </li>
                            ))}
                          </ul>
                        )}
                      </Alert>
                    )}
                    {lastCheck && <CheckDetails check={lastCheck} />}
                    <div className="flex flex-wrap items-end gap-3">
                      <Field label={t('caseBank.note')} className="min-w-48 flex-1">
                        {(fid) => <Input id={fid} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}
                      </Field>
                      <Button onClick={onSave} loading={save.isPending} disabled={!json.trim()}>
                        {t('caseBank.saveDraft')}
                      </Button>
                    </div>
                    <p className="text-xs text-muted">{t('caseBank.saveNote')}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export function nextCaseId(ids: string[]): string {
  const nums = ids.map((id) => Number(/^CASE(\d+)$/.exec(id)?.[1] ?? 0));
  const n = Math.max(0, ...nums) + 1;
  return `CASE${String(n).padStart(2, '0')}`;
}

function CaseGenerator({ existing, onCreated }: { existing: string[]; onCreated: (id: string) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const suggested = useMemo(() => nextCaseId(existing), [existing]);
  const [form, setForm] = useState({ caseId: suggested, topic: '', level: 'B1' as Level, learningObjectives: '', documentCount: 5, characterCount: 3, minutes: 30, writingType: 'report' as 'report' | 'email' | 'memo' });
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => setForm((f) => (existing.includes(f.caseId) ? { ...f, caseId: suggested } : f)), [existing, suggested]);
  const gen = useMutation({
    mutationFn: () => api.post<CaseDraftResult>('/api/admin/cases/generate', { ...form, topic: form.topic.trim(), learningObjectives: form.learningObjectives.trim() }),
    onSuccess: (r) => {
      toast.success(t('caseBank.generated', { id: form.caseId, v: r.version }));
      void qc.invalidateQueries({ queryKey: ['admin-cases'] });
      onCreated(form.caseId);
    },
  });
  useEffect(() => {
    if (!gen.isPending) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [gen.isPending]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    gen.mutate();
  };
  const num = (k: 'documentCount' | 'characterCount' | 'minutes') => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: Number(e.target.value) });
  const issues = validationIssues(gen.error);
  return (
    <Card>
      <SectionTitle>🤖 {t('caseBank.generator')}</SectionTitle>
      <p className="mb-4 text-sm text-muted">{t('caseBank.generatorHelp')}</p>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('caseBank.gen.caseId')}>{(id) => <Input id={id} required pattern="CASE\d{2,3}" value={form.caseId} onChange={(e) => setForm({ ...form, caseId: e.target.value.toUpperCase() })} />}</Field>
        <Field label={t('caseBank.gen.level')}>
          {(id) => (
            <Select id={id} value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value as Level })}>
              {LEVELS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('caseBank.gen.topic')} className="sm:col-span-2">
          {(id) => <Input id={id} required minLength={3} maxLength={200} placeholder={t('caseBank.gen.topicPlaceholder')} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />}
        </Field>
        <Field label={t('caseBank.gen.objectives')} className="sm:col-span-2 lg:col-span-4">
          {(id) => <Textarea id={id} required minLength={5} maxLength={800} rows={2} placeholder={t('caseBank.gen.objectivesPlaceholder')} value={form.learningObjectives} onChange={(e) => setForm({ ...form, learningObjectives: e.target.value })} />}
        </Field>
        <Field label={t('caseBank.gen.documents')}>{(id) => <Input id={id} type="number" min={4} max={8} value={form.documentCount} onChange={num('documentCount')} />}</Field>
        <Field label={t('caseBank.gen.characters')}>{(id) => <Input id={id} type="number" min={2} max={4} value={form.characterCount} onChange={num('characterCount')} />}</Field>
        <Field label={t('caseBank.gen.minutes')}>{(id) => <Input id={id} type="number" min={15} max={60} value={form.minutes} onChange={num('minutes')} />}</Field>
        <Field label={t('caseBank.gen.writingType')}>
          {(id) => (
            <Select id={id} value={form.writingType} onChange={(e) => setForm({ ...form, writingType: e.target.value as typeof form.writingType })}>
              {(['report', 'email', 'memo'] as const).map((w) => (
                <option key={w} value={w}>
                  {t(`briefing.taskType.${w}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="space-y-3 sm:col-span-2 lg:col-span-4">
          {gen.isPending && (
            <div className="space-y-2 rounded-xl bg-primary-soft p-3 text-sm" role="status" aria-live="polite">
              <div className="font-semibold">
                ⏳ {t('caseBank.generating')} <span className="tabular-nums">({elapsed}s)</span>
              </div>
              <p className="text-xs text-muted">{t('caseBank.generatingSteps')}</p>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface">
                <div className="indeterminate h-full w-1/3 rounded-full bg-primary" />
              </div>
            </div>
          )}
          {gen.isError && (
            <Alert tone="danger">
              {errorMessage(t, gen.error)}
              {issues.length > 0 && (
                <ul className="mt-1 list-disc pl-5 font-mono text-xs">
                  {issues.slice(0, 15).map((i, n) => (
                    <li key={n}>{i.message}</li>
                  ))}
                </ul>
              )}
            </Alert>
          )}
          <Button type="submit" data-testid="case-generate" loading={gen.isPending}>
            🤖 {t('caseBank.generate')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Case bank: list of cases with status, editor/preview, approval and the AI Case Generator. */
export function CaseBank({ canAdmin }: { canAdmin: boolean }) {
  const { t } = useTranslation();
  const { L } = useLocalized();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin-cases'], queryFn: () => api.get<{ cases: AdminCaseRow[] }>('/api/admin/cases') });
  const [open, setOpen] = useState<string | null>(null);
  const [confirmSeed, setConfirmSeed] = useState(false);
  const seed = useMutation({
    mutationFn: () => api.post<{ created: number }>('/api/admin/cases/seed'),
    onSuccess: (r) => {
      setConfirmSeed(false);
      toast.success(t('caseBank.seeded', { count: r.created }));
      void qc.invalidateQueries({ queryKey: ['admin-cases'] });
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const rows = q.data.cases;
  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle
          actions={
            canAdmin && (
              <Button variant="secondary" size="sm" onClick={() => setConfirmSeed(true)}>
                📦 {t('caseBank.seed')}
              </Button>
            )
          }
        >
          🗂️ {t('caseBank.title')}
        </SectionTitle>
        <p className="mb-4 text-sm text-muted">{t('caseBank.help')}</p>
        {rows.length === 0 ? (
          <EmptyState icon="🗂️" title={t('caseBank.empty')}>
            {canAdmin ? t('caseBank.emptyAdmin') : t('caseBank.emptyTeacher')}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>ID</th>
                <th>{t('caseBank.titleCol')}</th>
                <th>{t('teacher.status')}</th>
                <th>{t('caseBank.versions')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} data-testid={`cases-admin-row-${c.id}`} className="hover:bg-surface-2">
                  <td className="font-mono text-xs font-bold">{c.id}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <LevelBadge level={c.level} />
                      <span className="font-medium">{L(c.title) || '—'}</span>
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={STATUS_TONE[c.status]}>{t(`caseBank.status.${c.status}`)}</Badge>
                      {c.pendingApproval && <Badge tone="warn">{t('caseBank.pending')}</Badge>}
                    </div>
                  </td>
                  <td className="text-xs tabular-nums">
                    {t('caseBank.approvedV', { v: c.approvedVersion || '—' })} · {t('caseBank.latestV', { v: c.latestVersion })}
                  </td>
                  <td className="text-right">
                    <Button size="sm" variant="secondary" data-testid={`case-open-${c.id}`} onClick={() => setOpen(c.id)}>
                      {t('common.open')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <CaseGenerator existing={rows.map((r) => r.id)} onCreated={(id) => setOpen(id)} />
      {open && <CaseEditor id={open} canAdmin={canAdmin} onClose={() => setOpen(null)} />}
      <ConfirmModal open={confirmSeed} onClose={() => setConfirmSeed(false)} onConfirm={() => seed.mutate()} title={t('caseBank.seed')} confirmLabel={t('caseBank.seed')} loading={seed.isPending}>
        <p>{t('caseBank.seedBody')}</p>
      </ConfirmModal>
    </div>
  );
}
