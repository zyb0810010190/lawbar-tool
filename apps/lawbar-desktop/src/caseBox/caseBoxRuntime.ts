import { InMemoryCaseBoxPersistence } from "case-box-persistence";
import type { CaseBoxPersistence } from "case-box-persistence";

interface Runtime {
  readonly persistence: CaseBoxPersistence;
}

let runtime: Runtime | null = null;

export function getCaseBoxRuntime(): Runtime {
  if (runtime === null) {
    runtime = { persistence: new InMemoryCaseBoxPersistence() };
  }
  return runtime;
}

export function closeCaseBoxRuntime(): void {
  runtime = null;
}

export function _isCaseBoxRuntimeInitializedForTesting(): boolean {
  return runtime !== null;
}
