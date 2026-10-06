import { decodeAddress } from '@neuraiproject/neurai-create-transaction';

/**
 * Node dust threshold of an output, by address type (policy.cpp
 * `EstimateWitnessInputVBytes`): 546 sats for P2PKH, 3060 for the PQ families
 * (AuthScript v1 and strict v2) and 336 for ECDSA witness v3. A change output
 * below it makes the node reject the whole transaction.
 */
export function dustThresholdSats(address: string): bigint {
  try {
    const destination = decodeAddress(address);
    if (destination.type === 'pq' || destination.type === 'authscript') return 3060n;
    if (destination.type === 'ecdsa') return 336n;
  } catch {
    // Unknown shapes keep the Legacy threshold; the builder rejects them anyway.
  }
  return 546n;
}
