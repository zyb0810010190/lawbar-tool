// T3 证据目录及说明 DOCX export IPC handler (WI-FORMS-T3-S3-DOCX-EXPORT-00).
//
// ONE main-process channel (casebox:t3:exportDocx) that builds the S1 T3CatalogModel
// from the SAME drained-accepted-evidence source as the S2 preview (via the shared
// t3CatalogSource helper), packs the `docx` Document to a Buffer, and delivers it via
// the Electron save dialog. The RENDERER NEVER handles raw `.docx` bytes — it only ever
// receives a structured status (ADR §6 delivery decision):
//   - a { kind: "refusal" } model  → NO document, refusal surfaced ({ exported:false, refusal:{ code } })
//   - a { kind: "model" } saved    → { written: true }
//   - a { kind: "model" } cancelled → { written: false }  (a no-op SUCCESS, NOT an error)
//   - a build/write throw          → { ok: false, error }  (renderer reports inline)
//
// Overwrite confirmation is owned by the OS save dialog; the default filename ends in
// `.docx` and the dialog filter is DOCX (both supplied by main's injected deps). Tenant/
// matter scoping + forbidden-field rejection are inherited unchanged from the shared
// helper (identical to the preview handler).

import { type T3ExportDocxResult } from "./dto.js";
import { mapThrownError } from "./errorMap.js";
import { CHANNEL, type PersistenceProvider } from "./handlerShared.js";
import { buildT3CatalogModelForMatter } from "./t3CatalogSource.js";
import { packT3CatalogDocx } from "./export/t3DocxExport.js";

// Default save filename (ends in `.docx`; the dialog filter is supplied by main). The
// OS dialog owns the final path + overwrite confirmation.
const DEFAULT_FILE_NAME = "证据目录及说明.docx";

/**
 * Main-process delivery deps. Injected by electron main (electron/main.ts) so this
 * module stays free of any `electron` import and remains unit-testable in pure Node.
 * `showSaveDialog` opens the OS save dialog; a cancel is signalled by canceled:true /
 * filePath:null. `writeFile` persists the packed bytes to the chosen path. `pack` is the
 * S1-model → DOCX Buffer packer; it defaults to the real `packT3CatalogDocx` so production
 * behavior is unchanged, and is injectable only so tests can drive the pack-failure path.
 */
export interface T3ExportDocxDeps {
  readonly showSaveDialog: (options: {
    readonly defaultFileName: string;
  }) => Promise<{ readonly canceled: boolean; readonly filePath: string | null }>;
  readonly writeFile: (filePath: string, data: Buffer) => Promise<void>;
  readonly pack?: (model: Parameters<typeof packT3CatalogDocx>[0]) => Promise<Buffer>;
}

export async function exportT3DocxHandler(
  payload: unknown,
  provide: PersistenceProvider,
  deps: T3ExportDocxDeps,
): Promise<T3ExportDocxResult> {
  const source = await buildT3CatalogModelForMatter(payload, provide, CHANNEL.t3ExportDocx);
  if (source.kind === "error") {
    return { ok: false, error: source.error };
  }
  if (source.kind === "refusal") {
    // A refusal produces NO document — surface the review state, never a file.
    return { ok: true, value: { exported: false, refusal: { code: source.code } } };
  }
  // source.kind === "model": pack, then deliver via the save dialog.
  try {
    const pack = deps.pack ?? packT3CatalogDocx;
    const buffer = await pack(source.model);
    const saved = await deps.showSaveDialog({ defaultFileName: DEFAULT_FILE_NAME });
    if (saved.canceled || saved.filePath === null) {
      // Cancelling the save is a no-op SUCCESS, not an error (ADR §6).
      return { ok: true, value: { written: false } };
    }
    await deps.writeFile(saved.filePath, buffer);
    return { ok: true, value: { written: true } };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.t3ExportDocx }) };
  }
}
