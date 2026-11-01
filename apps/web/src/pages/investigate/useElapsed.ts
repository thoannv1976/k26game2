import { useEffect, useState } from 'react';
import { formatSeconds } from '../../lib/format';

/** mm:ss since `startedAt`, updated every second. */
export function useElapsed(startedAt: string, stopAt?: string | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (stopAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [stopAt]);
  const end = stopAt ? new Date(stopAt).getTime() : now;
  return formatSeconds((end - new Date(startedAt).getTime()) / 1000);
}
