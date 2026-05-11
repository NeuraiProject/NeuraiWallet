/**
 * Analytics stub.
 *
 * NeuraiWallet routed crash reports + opt-out logic through Bugsnag, hosted on
 * the NeuraiWallet team's account. NeuraiWallet does not currently have its own
 * crash-reporting backend, so we ship a no-op surface here to keep call sites
 * compiling (e.g. `setOptOut` from Settings, `logError` from About). When/if
 * Neurai sets up its own backend, swap this module's body — the public API
 * stays the same.
 */

const NoopAnalytics = {
  setOptOut(_optOut: boolean): void {},
  logError(_message: string): void {},
};

export default NoopAnalytics;
