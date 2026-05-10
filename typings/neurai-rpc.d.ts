/**
 * Type shim for `@neuraiproject/neurai-rpc`.
 *
 * The published package ships `dist/types.d.ts` but its `package.json#exports`
 * field omits a `"types"` condition, so TypeScript with `moduleResolution:
 * "bundler"` cannot pick them up. Until the package is fixed upstream, we
 * declare the (small) surface we use locally.
 */
declare module '@neuraiproject/neurai-rpc' {
  /** All known JSON-RPC method names exposed by a Neurai full node. */
  export const methods: Record<string, string>;

  /** Returns a callable that performs JSON-RPC requests against `url`. */
  export function getRPC(username: string, password: string, url: string): (method: string, params: unknown[]) => Promise<unknown>;
}
