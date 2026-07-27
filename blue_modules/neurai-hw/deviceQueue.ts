/**
 * Serializes every command sent to the NeuraiHW device.
 *
 * There is one physical serial port and the transport pairs responses to
 * commands **by arrival order**, with no correlation id: two commands issued
 * concurrently produce one orphaned request, and from then on every response is
 * matched to the wrong caller until something times out (35s). Symptoms seen in
 * the field were `Invalid JSON`, a `waitedMs` far larger than the command's real
 * latency, and the chat freezing on "checking the server".
 *
 * Independent parts of the app legitimately want to talk to the device at the
 * same moment — the chat poll, the capability probe, the connection health
 * check — so the exclusion has to live next to the resource rather than in any
 * one caller. Every access goes through `withDevice`, which runs the callbacks
 * one after another, regardless of whether the previous one resolved or threw.
 */

let chain: Promise<unknown> = Promise.resolve();

/** Run `fn` once the port is free; returns exactly what `fn` returns (or throws). */
export function withDevice<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  // Keep the chain alive even when a command fails: the next caller must still
  // get its turn rather than inherit a rejected promise.
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
