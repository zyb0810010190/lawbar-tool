// ocr:probe — the first OCR channel (product plan R3, WI-12 step 2).
//
// One read-only channel with NO payload: ask main to run the bundled helper's `probe` under the
// deadline, prove its identity, and report what the machine can do. It exists so the packaged
// acceptance can make the one assertion that fails if the integration is wrong in the likeliest
// way — that the helper which answered is the binary inside the launched bundle — and so a
// future screen can show the lawyer which OCR languages this Mac supports offline.
//
// Codes not messages: the renderer receives a code on failure and a projected record on success.
// No path crosses; the digests do, because they are the claim.

import { probeHelper, type HelperDeps, type HelperFailureCode } from "./helper.js";

export const OCR_CHANNEL = { probe: "ocr:probe" } as const;

export interface OcrProbeValue {
  /** The digest this app build was made with (the pin). Equal to the other two by construction. */
  readonly pinned_digest: string;
  readonly helper_build_digest: string;
  readonly executable_digest: string;
  readonly helper_version: string;
  readonly os_version: string;
  readonly os_build: string;
  readonly arch: string;
  readonly vision_languages: ReadonlyArray<string>;
  readonly roundtrip_ms: number | null;
  readonly roundtrip_text: string | null;
  readonly elapsed_ms: number;
}

export type OcrProbeResult =
  | { readonly ok: true; readonly value: OcrProbeValue }
  | { readonly ok: false; readonly code: HelperFailureCode | "invalid_request" };

export async function ocrProbeHandler(payload: unknown, deps: HelperDeps): Promise<OcrProbeResult> {
  // The channel takes nothing: `invoke("ocr:probe")` arrives as undefined. Anything else — null
  // included — is refused, so the channel can never grow a hidden argument.
  if (payload !== undefined) return { ok: false, code: "invalid_request" };
  const r = await probeHelper(deps, { roundtrip: true });
  if (!r.ok) return { ok: false, code: r.code };
  return {
    ok: true,
    value: {
      pinned_digest: deps.pinnedDigest as string,
      helper_build_digest: r.probe.helper_build_digest,
      executable_digest: r.executable_digest,
      helper_version: r.probe.helper_version,
      os_version: r.probe.os_version,
      os_build: r.probe.os_build,
      arch: r.probe.arch,
      vision_languages: r.probe.vision_languages,
      roundtrip_ms: r.probe.roundtrip_ms,
      roundtrip_text: r.probe.roundtrip_text,
      elapsed_ms: r.elapsed_ms,
    },
  };
}
