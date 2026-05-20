/* eslint-disable */
/**
 * AUTO-GENERATED from docs/contracts/case-box-contract/schemas/*.json by scripts/gen-types.mjs.
 * Do not edit by hand. Run `npm run gen:types` after changing a schema.
 */

/**
 * Party shape embedded in CaseBoxMatter.parties. See docs/adr/case-box-step-0-boundary.md.
 */
export interface CaseBoxParty {
  /**
   * Role of the party in the matter.
   */
  role: "client" | "opposing" | "third_party";
  /**
   * Lawyer-authored display name for the party.
   */
  display_name: string;
  party_kind: "individual" | "organization" | "government" | "court" | "other";
  notes?: string;
  [k: string]: unknown;
}
