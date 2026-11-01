import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { HINT_STAGES, type HintStage } from '@ed/shared';
import { api } from '../../api/client';
import type { HintResponse } from '../../api/types';
import { errorMessage } from '../../i18n/errors';
import { Alert, Badge, Button, Modal, cx } from '../../components/ui';
import { useWorkspace } from './session';

export function HintDialog({ open, onClose, initialStage }: { open: boolean; onClose: () => void; initialStage: HintStage }) {
  const { t } = useTranslation();
  const { sid, data, readOnly, apply } = useWorkspace();
  const [stage, setStage] = useState<HintStage>(initialStage);
  useEffect(() => {
    if (open) setStage(initialStage);
  }, [open, initialStage]);
  const hints = data.investigation.hints;
  const cur = hints[stage] ?? { used: 0, max: 3, revealed: [] };
  const get = useMutation({
    mutationFn: () => api.post<HintResponse>(`/api/sessions/${sid}/hint`, { stage }),
    onSuccess: apply,
  });
  return (
    <Modal open={open} onClose={onClose} title={`💡 ${t('hints.title')}`} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-muted">{t('hints.intro')}</p>
        <div role="radiogroup" aria-label={t('hints.stage')} className="flex flex-wrap gap-2">
          {HINT_STAGES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={stage === s}
              onClick={() => setStage(s)}
              className={cx('min-h-11 rounded-xl border px-3 text-sm font-semibold', stage === s ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface hover:border-primary')}
            >
              {t(`hints.stages.${s}`)} <span className="text-xs opacity-80">({hints[s]?.used ?? 0}/3)</span>
            </button>
          ))}
        </div>
        {cur.revealed.length === 0 ? (
          <p className="text-sm text-muted">{t('hints.none')}</p>
        ) : (
          <ol className="space-y-2" aria-live="polite">
            {cur.revealed.map((h, i) => (
              <li key={i} className="rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm">
                <Badge tone="warn" className="mb-1">
                  {t('hints.level', { level: i + 1 })}
                </Badge>
                <p lang="en">{h}</p>
              </li>
            ))}
          </ol>
        )}
        {get.isError && <Alert tone="danger">{errorMessage(t, get.error)}</Alert>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted">{t('hints.used', { used: cur.used, max: cur.max })}</span>
          {cur.used >= cur.max ? (
            <span className="text-sm text-muted">{t('hints.allUsed')}</span>
          ) : (
            !readOnly && (
              <Button data-testid="hint-get" onClick={() => get.mutate()} loading={get.isPending}>
                💡 {t('hints.get', { level: cur.used + 1 })}
              </Button>
            )
          )}
        </div>
      </div>
    </Modal>
  );
}
