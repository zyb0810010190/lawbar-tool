// Tarball PoC probe — runs the round-trip that verifies case-box-contract +
// case-box-persistence (+ better-sqlite3 native binding) load + execute
// correctly inside the packaged Electron main process. Per
// dev-memo/plan-desktop-pkg-arch-tarball-poc-01.md (rev-0.3; committed at
// 1d04256) §5.1 + §6.1.
//
// Invoked via globalThis.__lawbarTarballPocProbe (installed by the env-gated
// hook in electron/main.ts when LAWBAR_TARBALL_POC_TEST_HOOK=true). Test code
// calls it via Playwright's app.evaluate. The dynamic import here runs in the
// packaged main process's NATIVE ESM loader (NOT in app.evaluate's vm),
// bypassing the parent §26 step 3 ESM evidence-2 blocker.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface TarballPocProbeResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly durationMs?: number;
  readonly recordedTenantId?: string;
  readonly recordedMatterId?: string;
}

export async function runTarballPocProbe(): Promise<TarballPocProbeResult> {
  const startMs = Date.now();
  let tempDir: string | null = null;
  let openResult: { persistence: { createMatter(input: unknown): Promise<unknown> }; db: { close(): void } } | null = null;
  try {
    // Synthetic IDs — never derived from real-data sources. Crockford-base32
    // ULID-shape format: EXACTLY 26 chars, lowercase [0-9a-z] per the
    // case-box-contract schema regex `^[0-9a-z]{26}$`.
    const tenantId = "01jpoc00tenantsynt000lawb1";
    const matterId = "01jpoc00mattersynt000lawb1";

    // Build a fixture matter that matches case-box-contract's schema
    // (mirrors fixtures/valid/matter-advisory-minimal.valid.json but with
    // synthetic IDs). Inlined to avoid any runtime dependency on shipping
    // fixtures inside the packaged .app.
    const matter = {
      id: matterId,
      tenant_id: tenantId,
      actor_user_id: "local-user",
      name: "PoC — synthetic tarball verification matter",
      jurisdiction: { value: "cn-sh", locked: false },
      matter_type: "advisory",
      parties: [
        { role: "client", display_name: "PoC Synthetic Client", party_kind: "organization" },
      ],
      confidentiality_class: "normal",
      status: "active",
      external_ocr_authorized: false,
      sync_grant_present: false,
      llm_extraction_opt_in: false,
      created_at: "2026-05-26T00:00:00.000Z",
    };

    // Pass 1 — validate via case-box-contract.
    const contractMod = await import("case-box-contract");
    const validationResult = (contractMod as { validateMatter: (p: unknown) => { ok: boolean; errors?: unknown[] } })
      .validateMatter(matter);
    if (!validationResult.ok) {
      return {
        ok: false,
        error: `validateMatter rejected the fixture matter: ${JSON.stringify(validationResult.errors).slice(0, 200)}`,
      };
    }

    // Pass 2 — persist via case-box-persistence (better-sqlite3 native).
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawbar-tarball-poc-"));
    const dbPath = path.join(tempDir, "tarball-poc.db");

    const persistenceMod = await import("case-box-persistence");
    const { openSqliteCaseBoxPersistence } = persistenceMod as {
      openSqliteCaseBoxPersistence: (opts: { path: string }) => {
        persistence: { createMatter(input: unknown): Promise<unknown> };
        db: { close(): void };
      };
    };
    openResult = openSqliteCaseBoxPersistence({ path: dbPath });

    const created = await openResult.persistence.createMatter(matter) as { id: string; tenant_id: string };
    if (typeof created !== "object" || created === null
        || typeof created.id !== "string" || typeof created.tenant_id !== "string") {
      return {
        ok: false,
        error: `createMatter returned an unexpected shape: ${JSON.stringify(created).slice(0, 200)}`,
      };
    }

    return {
      ok: true,
      durationMs: Date.now() - startMs,
      recordedTenantId: created.tenant_id,
      recordedMatterId: created.id,
    };
  } catch (e) {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { ok: false, error: message };
  } finally {
    if (openResult !== null) {
      try { openResult.db.close(); } catch { /* ignore */ }
    }
    if (tempDir !== null) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}
