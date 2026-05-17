/**
 * Minimal pub/sub used to notify the React state layer when a Neurai wallet's
 * cached state changed because of a WSS push (`address.changed`). Without
 * this, the home screen's `wallets` array from `useStorage` keeps the same
 * object identity after a push-triggered refetch and the UI never re-renders.
 *
 * Kept deliberately small: the only producer is `AbstractNeuraiWallet`'s push
 * handler, and the only consumer is `StorageProvider`, which calls
 * `setWallets([...wallets])` to bump the array identity.
 */

type Listener = (walletId: string) => void;

const listeners = new Set<Listener>();

export function emitWalletChanged(walletId: string): void {
  for (const cb of listeners) {
    try {
      cb(walletId);
    } catch (err) {
      console.debug('neuraiEventBus: listener threw', err);
    }
  }
}

export function onWalletChanged(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
