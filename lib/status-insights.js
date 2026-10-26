/**
 * Shared predicates for CLI reporting (status/doctor). Thin re-exports so the
 * CLI never imports the plugin entry (which pulls DSH packages).
 */
export { isProvenProcedure, procedureInvalidated as invalidatedProcedure } from "./index-block.js";
