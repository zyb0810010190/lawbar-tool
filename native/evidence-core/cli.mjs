#!/usr/bin/env node
// cli.mjs — Evidence-Genie M0 harness contract SHIM entry point (JS-only; NOT the Swift/PDFKit A0.7 core).
//
// Usage: node native/evidence-core/cli.mjs <command>
// Emits a single deterministic JSON envelope on stdout and exits 0 (passed) or non-zero
// (not_implemented / failed / error). Side-effect-free: it never writes a file or a marker, and never
// writes under dev-memo/run/evidence/. See lib/commands.mjs for the contract and README.md for scope.

import { runCommand } from "./lib/commands.mjs";

const command = process.argv[2];
const { envelope, exitCode } = runCommand(command);
process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
process.exit(exitCode);
