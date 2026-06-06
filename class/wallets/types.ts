import { XnaUnit } from '../../models/xnaUnits';
import { NeuraiHDWallet } from './neurai-hd-wallet';
import { NeuraiPQWallet } from './neurai-pq-wallet';
import { NeuraiHardwareWallet } from './neurai-hardware-wallet';

/**
 * Minimal UTXO shape consumed by the legacy abstract-wallet code paths and
 * the Neurai engine wrapper. The Neurai-specific UTXO carries `outputIndex`
 * and `satoshis`; here we keep the NeuraiWallet-style fields the older
 * `_utxo` cache uses.
 */
export type Utxo = {
  height: number;
  address: string;
  txid: string;
  vout: number;
  value: number;
  txhex?: string;
  confirmations?: number;
  wif?: string | false;
};

type TransactionInput = {
  txid: string;
  vout: number;
  scriptSig: { asm: string; hex: string };
  txinwitness: string[];
  sequence: number;
  addresses?: string[];
  address?: string;
  value?: number;
};

export type TransactionOutput = {
  value: number;
  n: number;
  scriptPubKey: {
    asm: string;
    hex: string;
    reqSigs: number;
    type: string;
    addresses: string[];
  };
};

export type Transaction = {
  txid: string;
  hash: string;
  version: number;
  size: number;
  vsize: number;
  weight: number;
  locktime: number;
  inputs: TransactionInput[];
  outputs: TransactionOutput[];
  blockhash: string;
  confirmations: number;
  time: number;
  blocktime: number;
  /** seconds, not milliseconds */
  timestamp: number;
  value?: number;
};

/**
 * In some cases we add additional data to each tx object so the code that
 * works with that transaction can find the wallet that owns it.
 */
export type ExtendedTransaction = Transaction & {
  walletID: string;
  walletPreferredBalanceUnit: XnaUnit;
};

/**
 * The wallet types the storage layer can serialize today. Neurai HD (legacy
 * ECDSA) and Neurai PQ (ML-DSA-44 AuthScript) are the only supported kinds —
 * see [class/wallets/abstract-neurai-wallet.ts](abstract-neurai-wallet.ts) for
 * the shared base.
 */
export type TWallet = NeuraiHDWallet | NeuraiPQWallet | NeuraiHardwareWallet;
