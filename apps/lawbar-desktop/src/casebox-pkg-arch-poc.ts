// PoC probe per dev-memo/plan-desktop-pkg-arch-tarball-poc-00.md §5.
//
// Proves the desktop app can import + execute BOTH case-box-persistence AND
// case-box-contract at runtime inside the packaged Electron binary. Exercises
// the SPECIFIC failure path (case-box-contract/dist/ajv-instance.js) that
// defeated WI-B Option B.
//
// Invoked from electron/main.ts when --probe-casebox-pkg-arch is in argv.

import { InMemoryCaseBoxPersistence } from "case-box-persistence";
import { validateMatter } from "case-box-contract";

export interface PkgArchProbeResult {
  readonly ok: boolean;
  readonly matterId?: string;
  readonly validatorOk?: boolean;
  readonly error?: string;
  readonly durationMs?: number;
}

// Deterministic fixed payload satisfying all 13 required fields of
// docs/contracts/case-box-contract/schemas/case-box-matter.schema.json.
// id matches schema regex `^[0-9a-z]{26}$` (NOT restricted to Crockford;
// the schema accepts all lowercase a-z per rev-2 typo fix in plan §12).
const FIXED_PAYLOAD = Object.freeze({
  id: "01h0000000000000000000poc1",
  tenant_id: "default-tenant",
  actor_user_id: "local-user",
  name: "PoC matter",
  jurisdiction: { value: "us-ca-superior", locked: false },
  matter_type: "advisory" as const,
  parties: [
    {
      role: "client" as const,
      display_name: "PoC client",
      party_kind: "individual" as const,
    },
  ],
  confidentiality_class: "normal" as const,
  status: "active" as const,
  external_ocr_authorized: false,
  sync_grant_present: false,
  llm_extraction_opt_in: false,
  created_at: "2026-05-25T00:00:00.000Z",
});

export async function runPkgArchProbe(): Promise<PkgArchProbeResult> {
  const t0 = Date.now();
  try {
    // [1] Exercise case-box-contract Ajv runtime — the SPECIFIC path that
    //     failed in WI-B Option B (case-box-contract/dist/ajv-instance.js
    //     couldn't be loaded under electron-builder's ASAR).
    const validation = validateMatter(FIXED_PAYLOAD);
    if (!validation.ok) {
      return {
        ok: false,
        error: `validateMatter failed: ${JSON.stringify(validation.errors).slice(0, 200)}`,
        durationMs: Date.now() - t0,
      };
    }

    // [2] Exercise case-box-persistence runtime + audit emission.
    const persistence = new InMemoryCaseBoxPersistence();
    const created = await persistence.createMatter(FIXED_PAYLOAD);
    if (created.id !== FIXED_PAYLOAD.id) {
      return {
        ok: false,
        error: `createMatter returned id=${created.id}; expected ${FIXED_PAYLOAD.id}`,
        durationMs: Date.now() - t0,
      };
    }

    return {
      ok: true,
      matterId: created.id,
      validatorOk: true,
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      durationMs: Date.now() - t0,
    };
  }
}
