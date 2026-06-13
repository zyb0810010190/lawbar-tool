// renderer/i18n/t.ts — message resolver (WI-i18n-1, infra-only).
// Per dev-memo/plan-i18n-impl-00.md. v1 LOCALE = "zh-CN" (D1); NO runtime switching (D2).
//
// `t(id, params?)` resolves a catalog key to its zh-CN text with NAMED interpolation only.
// Failure policy (decision, review-folded): ALWAYS THROW on a missing key OR a missing required
// param — no dev/prod split, no marker fallback — until a real production fallback policy exists.
// A loud failure surfaces wiring/translation gaps immediately instead of rendering partial copy.

import { CATALOG, type CatalogId } from "./catalog.js";

export const LOCALE = "zh-CN" as const;

export type TParams = Readonly<Record<string, string | number>>;

const PLACEHOLDER_RE = /\{(\w+)\}/g;

export function t(id: CatalogId, params?: TParams): string {
  const template = CATALOG[id];
  if (template === undefined) {
    // Unreachable for a CatalogId at the type level; guards against a cast/`as` at a call site.
    throw new Error(`i18n: missing catalog key "${String(id)}" (locale ${LOCALE})`);
  }
  return template.replace(PLACEHOLDER_RE, (_match, name: string) => {
    if (params === undefined || !Object.prototype.hasOwnProperty.call(params, name)) {
      throw new Error(`i18n: missing param "${name}" for key "${String(id)}"`);
    }
    return String(params[name]);
  });
}
