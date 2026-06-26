// Case-box IPC DTO barrel (WI-DTO1). The per-entity DTO definitions live in
// ./dto/<entity>.ts; this file re-exports them so every importer keeps using
// `./dto.js` unchanged. Split from a 797-LOC monolith to resolve DTO-LOC-797.
// Keep this a pure re-export barrel — add new DTOs to the per-entity module.

export * from "./dto/shared.js";
export * from "./dto/matter.js";
export * from "./dto/audit.js";
export * from "./dto/document.js";
export * from "./dto/deadline.js";
export * from "./dto/docket.js";
export * from "./dto/fact.js";
export * from "./dto/link.js";
