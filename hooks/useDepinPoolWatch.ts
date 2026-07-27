/**
 * Background "new messages" indicator for the DePIN chat.
 *
 * Polls only `depinpoolstats`, the one DePIN RPC that is not privacy-wrapped:
 * it needs no identity, no session and no device, so the check never asks the
 * owner to approve anything and never touches the hardware wallet. One small
 * request a minute is enough to notice that the channel moved; the actual
 * decryption (and the device round-trips it costs) still happens only when the
 * user opens the chat.
 *
 * The marker means "the channel has new traffic" — whether a given message is
 * addressed to this wallet can only be known by decrypting it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { getDepinRpcBackend, loadDepinRpcOverrides, type NeuraiNetwork } from '../blue_modules/neurai';
import {
  getSeenSignature,
  isMeaningfulSignature,
  loadSeenSignature,
  poolSignature,
  subscribePoolSeen,
} from '../blue_modules/neurai/depinPoolSeen';

/** Deliberately slow: this only drives a dot, and the chat itself polls far more often when open. */
const POOL_WATCH_INTERVAL_MS = 60_000;

export function useDepinPoolWatch(params: { enabled: boolean; network: NeuraiNetwork }): { hasNewMessages: boolean } {
  const { enabled, network } = params;
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const latestSignatureRef = useRef<string | null>(null);

  const evaluate = useCallback(() => {
    const latest = latestSignatureRef.current;
    if (!latest || !isMeaningfulSignature(latest)) {
      setHasNewMessages(false);
      return;
    }
    const seen = getSeenSignature(network);
    // Nothing seen yet: treat the current state as the baseline rather than
    // greeting a first-time user with a permanent dot.
    setHasNewMessages(seen != null && seen !== latest);
  }, [network]);

  useEffect(() => {
    if (!enabled) {
      setHasNewMessages(false);
      return;
    }
    let cancelled = false;

    const check = async () => {
      try {
        await loadDepinRpcOverrides();
        const stats = await getDepinRpcBackend(network).rpc<{ total_messages?: unknown; newest_message?: unknown }>('depinpoolstats', []);
        if (cancelled) return;
        latestSignatureRef.current = poolSignature(stats);
        evaluate();
      } catch {
        // Node unreachable: leave the marker as it is rather than clearing it.
      }
    };

    (async () => {
      await loadSeenSignature(network);
      if (!cancelled) check();
    })();

    const interval = setInterval(check, POOL_WATCH_INTERVAL_MS);
    // Reading the chat updates the stored signature — reflect it immediately
    // instead of waiting out the next tick.
    const unsubscribe = subscribePoolSeen(evaluate);
    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribe();
    };
  }, [enabled, network, evaluate]);

  return { hasNewMessages };
}

export default useDepinPoolWatch;
