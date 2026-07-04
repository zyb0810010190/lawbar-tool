// T3 证据目录及说明 preview IPC handler (WI-FORMS-T3-S2-CATALOG-PREVIEW-00).
// ONE read-only channel: reads the matter + DRAINS all status:"accepted" evidence
// pages, then calls the MERGED S1 buildT3CatalogModel ONCE over the complete set
// (S1 is the single source of truth — never re-implemented). The matter+drain+build
// logic now lives in the shared t3CatalogSource helper so the S3 DOCX export channel
// builds the model from the SAME source (WI-FORMS-T3-S3-DOCX-EXPORT-00); this handler
// only maps the discriminated source result to the preview envelope.
//
// A submitter refusal is an EXPECTED review state carried in the SUCCESS value as a
// discriminated union { kind: "refusal", code }; a read error stays { ok: false, error }.
// The handler NEVER returns null and NEVER lets a T3CatalogRefusal escape as a crash.

import { type T3PreviewCatalogResult } from "./dto.js";
import { CHANNEL, type PersistenceProvider } from "./handlerShared.js";
import { buildT3CatalogModelForMatter } from "./t3CatalogSource.js";
import { t3CatalogModelSha256 } from "./export/t3CatalogModel.js";

export async function previewT3CatalogHandler(
  payload: unknown,
  provide: PersistenceProvider,
): Promise<T3PreviewCatalogResult> {
  const source = await buildT3CatalogModelForMatter(payload, provide, CHANNEL.t3PreviewCatalog);
  switch (source.kind) {
    case "model":
      return {
        ok: true,
        value: { kind: "model", model: source.model, modelSha256: t3CatalogModelSha256(source.model) },
      };
    case "refusal":
      return { ok: true, value: { kind: "refusal", code: source.code } };
    case "error":
      return { ok: false, error: source.error };
  }
}
