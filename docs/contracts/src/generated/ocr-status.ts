/* eslint-disable */
/**
 * AUTO-GENERATED from docs/contracts/schemas/*.json by scripts/gen-types.mjs.
 * Do not edit by hand. Run `npm run gen:types` after changing a schema.
 */

/**
 * Validates a single status envelope (object form) or an ordered sequence of transitions (array form). See docs/contracts/ocr-worker-contract.md §3.
 */
export type OcrStatus = StatusEnvelope | TransitionSequence;
export type Semver = string;
export type Ulid = string;
export type State =
  | "queued"
  | "claimed"
  | "processing"
  | "succeeded"
  | "failed"
  | "partial_succeeded"
  | "cancelled"
  | "dead_lettered";
export type Actor = "queue" | "worker" | "web_app";

export interface StatusEnvelope {
  contract_version: Semver;
  job_id: Ulid;
  tenant_id: Ulid;
  state: State;
  observed_at: string;
  metadata?: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
export interface TransitionSequence {
  job_id: Ulid;
  /**
   * @minItems 1
   */
  transitions: [
    {
      from: State;
      to: State;
      controlled_by: Actor;
      at: string;
      note?: string;
      [k: string]: unknown;
    },
    ...{
      from: State;
      to: State;
      controlled_by: Actor;
      at: string;
      note?: string;
      [k: string]: unknown;
    }[]
  ];
  [k: string]: unknown;
}
