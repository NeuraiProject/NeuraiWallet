/**
 * The general "use only the main address" setting. The settings provider
 * loads it and keeps it here, where the wallets read it: a Legacy or ECDSA
 * wallet uses only its first address when this or its own setting is on.
 */

let singleAddressForAll = false;

export function setSingleAddressForAll(on: boolean): void {
  singleAddressForAll = on;
}

export function isSingleAddressForAll(): boolean {
  return singleAddressForAll;
}
