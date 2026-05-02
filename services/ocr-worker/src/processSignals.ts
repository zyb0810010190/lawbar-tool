// Step 10E — POSIX signal → AbortController bridge.
//
// First arrival of any configured signal flips the AbortController.
// Subsequent arrivals (on any of the configured signals, including the
// same one twice) are forwarded to `onSecondSignal` so the runtime can
// log "shutting down already, please wait" without forcing the loop to
// abandon an in-flight `processOne()`.
//
// The current `OcrWorker.process()` contract has no AbortSignal channel,
// so this module CANNOT cancel a running OCR call mid-flight. That is
// intentional — see the Step 10E ADR.

import type { EventEmitter } from "node:events";

// Minimal structural surface so the unit tests can drive a plain
// EventEmitter through this code without importing all of `process`.
export interface SignalSource {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
}

export type SupportedSignal = NodeJS.Signals;

export interface InstallShutdownHandlersOptions {
  /** Process-like emitter. Default: the global `process`. */
  process?: SignalSource | EventEmitter;
  /** Signals to listen for. Default: ["SIGINT", "SIGTERM"]. */
  signals?: ReadonlyArray<SupportedSignal>;
  /**
   * Called for the second-and-subsequent signal arrivals. Default: a
   * no-op. The CLI uses this to write a "shutdown in progress" message
   * to stderr; tests use it to assert call ordering.
   */
  onSecondSignal?: (sig: SupportedSignal) => void;
}

export interface InstalledShutdownHandlers {
  /** AbortSignal that flips on first signal arrival. */
  signal: AbortSignal;
  /** Remove every listener installed by `installShutdownHandlers`. */
  uninstall: () => void;
}

const DEFAULT_SIGNALS: ReadonlyArray<SupportedSignal> = ["SIGINT", "SIGTERM"];

/**
 * Install signal listeners that flip an AbortController on first arrival.
 * The returned handle exposes the `AbortSignal` and an `uninstall()`
 * function that removes every installed listener so a finished CLI does
 * not leak event handlers (and Node's reference count can let the
 * process exit naturally).
 */
export function installShutdownHandlers(
  options: InstallShutdownHandlersOptions = {},
): InstalledShutdownHandlers {
  const proc = (options.process ?? (globalThis as { process?: SignalSource }).process) as
    | SignalSource
    | undefined;
  if (proc === undefined) {
    throw new Error("installShutdownHandlers: no process-like emitter available");
  }
  const signals = options.signals ?? DEFAULT_SIGNALS;
  const onSecond = options.onSecondSignal ?? (() => undefined);

  const controller = new AbortController();
  let aborted = false;

  // One listener per signal so off() can remove it precisely.
  const listeners = new Map<SupportedSignal, (...args: unknown[]) => void>();
  for (const sig of signals) {
    const listener = (): void => {
      if (!aborted) {
        aborted = true;
        controller.abort();
      } else {
        try {
          onSecond(sig);
        } catch {
          // Hook errors must not bring down the process — they are
          // observability, not control flow.
        }
      }
    };
    listeners.set(sig, listener);
    proc.on(sig, listener);
  }

  const uninstall = (): void => {
    for (const [sig, listener] of listeners) {
      proc.off(sig, listener);
    }
    listeners.clear();
  };

  return { signal: controller.signal, uninstall };
}
