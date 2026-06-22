// commands.mjs — the deterministic-JSON command contract for the Evidence-Genie M0 harness SHIM.
//
// This is a JS-only contract shim. It is NOT the real native Evidence Core (Swift/PDFKit A0.7 harness),
// which is a separate, explicitly-authorized autonomy hard-stop WI. Every "gate" command therefore reports
// `not_implemented` — which FAILS (non-zero exit), never passes — until that later WI lands.
//
// Determinism contract (per WI-EVW7 + .claude/rules/evidence-genie.md):
//   - output is JSON only, with a stable `schemaVersion` and fixed top-level keys;
//   - NO timestamps and NO randomness anywhere in the output;
//   - `status: "passed"`        => pass  (exit 0);
//   - `status: "failed"`        => fail  (exit non-zero);
//   - `status: "not_implemented"` => FAIL (exit non-zero), never a pass;
//   - an unknown/malformed command => deterministic error JSON (exit non-zero);
//   - no command writes a file, a marker, or anything under dev-memo/run/evidence/.

export const SCHEMA_VERSION = "1.0.0";

// Utility commands that genuinely work and pass.
export const UTILITY_COMMANDS = ["version", "healthcheck"];

// The eight Evidence gate commands. All `not_implemented` (fail) in the shim — they require the real
// native harness + fixtures that do not exist yet. `renderer-conformance` (A0.7) must stay not_implemented.
export const GATE_COMMANDS = [
  "renderer-conformance",
  "geometry-roundtrip",
  "citation-stability-gate",
  "coordinate-roundtrip",
  "a3-regression",
  "snapshot-verify",
  "golden-export",
  "compress-readability-fixtures",
];

export const ALL_COMMANDS = [...UTILITY_COMMANDS, ...GATE_COMMANDS];

// Exit-code contract.
const EXIT = { passed: 0, not_implemented: 1, failed: 1, error: 2 };

// Build a deterministic envelope with a fixed key order. `result` XOR `error`.
function envelope({ ok, command, status, diagnostics, result, error }) {
  const env = {
    schemaVersion: SCHEMA_VERSION,
    ok,
    command,
    status,
    diagnostics: diagnostics ?? [],
  };
  if (error !== undefined) env.error = error;
  else env.result = result ?? {};
  return env;
}

// Resolve a command to { envelope, exitCode }. Pure: no I/O, no clock, no randomness.
export function runCommand(command) {
  if (command === undefined || command === null || command === "") {
    return malformed("(none)", "no command given");
  }
  if (typeof command !== "string") {
    return malformed(String(command), "command must be a string");
  }

  if (command === "version") {
    return {
      envelope: envelope({
        ok: true,
        command,
        status: "passed",
        diagnostics: [],
        result: {
          schemaVersion: SCHEMA_VERSION,
          shim: true,
          isRealNativeCore: false,
          utilityCommands: UTILITY_COMMANDS,
          gateCommands: GATE_COMMANDS,
          note: "JS-only contract shim; NOT the Swift/PDFKit A0.7 implementation. Gate commands report not_implemented (fail) until the real native Evidence Core lands.",
        },
      }),
      exitCode: EXIT.passed,
    };
  }

  if (command === "healthcheck") {
    return {
      envelope: envelope({
        ok: true,
        command,
        status: "passed",
        diagnostics: [],
        result: { healthy: true, shim: true },
      }),
      exitCode: EXIT.passed,
    };
  }

  if (GATE_COMMANDS.includes(command)) {
    return {
      envelope: envelope({
        ok: false,
        command,
        status: "not_implemented",
        diagnostics: [
          "This gate is not implemented in the JS-only contract shim.",
          "not_implemented FAILS, never passes.",
          "The real implementation is the native Evidence Core (Swift/PDFKit A0.7 harness), a separate explicitly-authorized WI.",
        ],
        error: {
          code: "not_implemented",
          message: `Command '${command}' is not implemented in the contract shim and therefore fails. Implement it in the real native Evidence Core (deferred WI) before relying on it.`,
        },
      }),
      exitCode: EXIT.not_implemented,
    };
  }

  return malformed(command, "unknown command");
}

function malformed(command, reason) {
  return {
    envelope: envelope({
      ok: false,
      command,
      status: "error",
      diagnostics: [reason],
      error: {
        code: "unknown_command",
        message: `Unknown or malformed command '${command}': ${reason}.`,
        knownCommands: ALL_COMMANDS,
      },
    }),
    exitCode: EXIT.error,
  };
}
