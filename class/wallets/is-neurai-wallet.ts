/**
 * Type guard for Neurai wallets. Used by screens that need to branch
 * Bitcoin-era code paths (`SendDetails`, `ReceiveDetails`,
 * `WalletTransactions`) and route to the simplified Neurai flows instead.
 *
 * The guard narrows to the concrete `NeuraiHDWallet | NeuraiPQWallet` union
 * (the members of `TWallet`) rather than the abstract base, so callers using
 * `wallets.find(...)` get a useful narrowed type without losing access to
 * fields that only exist on the subclasses.
 */
import { NeuraiHDWallet } from './neurai-hd-wallet';
import { NeuraiPQWallet } from './neurai-pq-wallet';
import { NeuraiHardwareWallet } from './neurai-hardware-wallet';

export function isNeuraiWallet(
  wallet: { type?: string } | undefined | null,
): wallet is NeuraiHDWallet | NeuraiPQWallet | NeuraiHardwareWallet {
  if (!wallet) return false;
  return wallet.type === NeuraiHDWallet.type || wallet.type === NeuraiPQWallet.type || wallet.type === NeuraiHardwareWallet.type;
}
