import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { SessionPayload } from '../../api/types';

export type TabId = 'documents' | 'questions' | 'interviews' | 'board' | 'notebook' | 'report';
export const TABS: TabId[] = ['documents', 'questions', 'interviews', 'board', 'notebook', 'report'];

/** Keeps only the session view from a mutation response (drops `result`, `message`, `resumed`…). */
export function stripView(r: SessionPayload): SessionPayload {
  return { session: r.session, investigation: r.investigation, interviews: r.interviews, assistant: r.assistant, notebook: r.notebook, draft: r.draft };
}

export const sessionKey = (sid: string) => ['session', sid] as const;

/** Every mutating endpoint returns the whole view: write it into the query cache. */
export function useApplyView(sid: string) {
  const qc = useQueryClient();
  return useCallback((r: SessionPayload) => qc.setQueryData(sessionKey(sid), stripView(r)), [qc, sid]);
}

/* ---------------- notebook (shared by the Notebook tab, the side panel and "Save to notebook") ---------------- */

export type NotebookStatus = 'saved' | 'dirty' | 'saving' | 'error';

export interface NotebookApi {
  text: string;
  setText: (t: string) => void;
  append: (t: string) => void;
  status: NotebookStatus;
}

function useNotebookState(sid: string, initial: string, readOnly: boolean): NotebookApi {
  const [text, setTextState] = useState(initial);
  const [status, setStatus] = useState<NotebookStatus>('saved');
  const latest = useRef(initial);
  const saved = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const qc = useQueryClient();

  const flush = useCallback(async () => {
    if (readOnly || saving.current || latest.current === saved.current) return;
    saving.current = true;
    setStatus('saving');
    const sending = latest.current;
    try {
      const r = await api.put<{ notebook: SessionPayload['notebook'] }>(`/api/sessions/${sid}/notes`, { text: sending });
      saved.current = sending;
      qc.setQueryData<SessionPayload>(sessionKey(sid), (old) => (old ? { ...old, notebook: r.notebook } : old));
      setStatus(latest.current === sending ? 'saved' : 'dirty');
    } catch {
      setStatus('error');
    } finally {
      saving.current = false;
      if (latest.current !== saved.current) schedule(3000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, readOnly, qc]);

  const schedule = useCallback(
    (ms = 1500) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), ms);
    },
    [flush],
  );

  const setText = useCallback(
    (t: string) => {
      latest.current = t;
      setTextState(t);
      setStatus(t === saved.current ? 'saved' : 'dirty');
      schedule();
    },
    [schedule],
  );

  const append = useCallback(
    (t: string) => {
      const cur = latest.current;
      setText(cur.trim() ? `${cur.replace(/\s+$/, '')}\n\n${t}` : t);
    },
    [setText],
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      if (timer.current) clearTimeout(timer.current);
      void flush();
    };
  }, [flush]);

  return { text, setText, append, status };
}

/* ---------------- workspace context ---------------- */

interface Workspace {
  sid: string;
  data: SessionPayload;
  readOnly: boolean;
  apply: (r: SessionPayload) => void;
  notebook: NotebookApi;
  goTo: (tab: TabId, docId?: string) => void;
  refetch: () => void;
}

const Ctx = createContext<Workspace | null>(null);

export function WorkspaceProvider({ sid, data, goTo, refetch, children }: { sid: string; data: SessionPayload; goTo: Workspace['goTo']; refetch: () => void; children: ReactNode }) {
  const readOnly = data.session.status !== 'active';
  const apply = useApplyView(sid);
  const notebook = useNotebookState(sid, data.notebook.text, readOnly);
  return <Ctx.Provider value={{ sid, data, readOnly, apply, notebook, goTo, refetch }}>{children}</Ctx.Provider>;
}

export function useWorkspace(): Workspace {
  const w = useContext(Ctx);
  if (!w) throw new Error('useWorkspace outside WorkspaceProvider');
  return w;
}
