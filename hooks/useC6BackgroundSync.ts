import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

type Tip = { height: number; hash: string };
type Options = {
  active: boolean;
  paused: boolean;
  tip?: Tip;
  rpc: ((method: string, params?: unknown[]) => Promise<any>) | null;
  canStart: () => boolean;
  scan: () => Promise<unknown>;
  apply: (messages: any) => void;
};

const POLL_MS = 20_000;

/**
 * Port of the web wallet's C6 auto-sync: check the tip cheaply while the app
 * is in the foreground and rescan only when it changed. The caller shares the
 * pending promise with foreground actions, because a single worker must never
 * receive overlapping scan/prove/journal requests. It never broadcasts.
 */
export function useC6BackgroundSync(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const pending = useRef<Promise<void> | null>(null);
  const generation = useRef(0);
  const failures = useRef(0);
  const retryAt = useRef(0);
  const [syncing, setSyncing] = useState(false);
  const [warning, setWarning] = useState('');

  const reset = useCallback(() => {
    generation.current++;
    pending.current = null;
    failures.current = 0;
    retryAt.current = 0;
    setSyncing(false);
    setWarning('');
  }, []);
  /** Late replies of the current generation are ignored from now on. */
  const invalidate = useCallback(() => {
    generation.current++;
    pending.current = null;
  }, []);
  const isRunning = useCallback(() => pending.current !== null, []);
  const wait = useCallback(() => pending.current ?? Promise.resolve(), []);

  const poll = useCallback(() => {
    const o = latest.current;
    if (
      pending.current ||
      !o.active ||
      o.paused ||
      !o.rpc ||
      !o.canStart() ||
      AppState.currentState !== 'active' ||
      Date.now() < retryAt.current
    ) {
      return;
    }
    const rpc = o.rpc;
    const token = generation.current;
    const valid = () => token === generation.current && latest.current.active;
    const job = Promise.resolve()
      .then(async () => {
        const hash = await rpc('getbestblockhash', []);
        if (!valid()) return;
        if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) throw new Error('RPC returned an invalid chain tip');
        // A foreground action may have taken the worker while the tip RPC was pending.
        if (latest.current.paused || !latest.current.canStart()) return;
        if (hash !== latest.current.tip?.hash) {
          setSyncing(true);
          const result = await latest.current.scan();
          if (!valid()) return;
          latest.current.apply(result);
        }
        if (valid()) {
          failures.current = 0;
          retryAt.current = 0;
          setWarning('');
        }
      })
      .catch(error => {
        if (!valid()) return;
        failures.current++;
        retryAt.current = Date.now() + Math.min(120_000, POLL_MS * 2 ** Math.min(failures.current, 3));
        setWarning(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (pending.current === job) {
          pending.current = null;
          if (valid()) setSyncing(false);
        }
      });
    pending.current = job;
  }, []);

  useEffect(() => {
    reset();
    if (!options.active) return;
    const timer = setInterval(poll, POLL_MS);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') poll();
    });
    return () => {
      invalidate();
      clearInterval(timer);
      subscription.remove();
    };
  }, [options.active, options.rpc, poll, reset, invalidate]);

  return { syncing, warning, wait, isRunning, reset };
}
