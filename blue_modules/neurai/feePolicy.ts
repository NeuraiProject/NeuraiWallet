/** Main node default min-relay policy: 0.01 XNA per 1,000 virtual bytes.
 * Apply the requested 20% margin locally; never use the node's smart estimate.
 * A node with a higher configured/dynamic floor can still reject the transaction.
 */
export const LOCAL_FEE_RATE_XNA_PER_KB = 0.012;
export const LOCAL_FEE_RATE_RPC = String(LOCAL_FEE_RATE_XNA_PER_KB);
