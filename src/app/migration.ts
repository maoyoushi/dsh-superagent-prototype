/**
 * Database schema versions this build opens. Schema 12 made the plan Source the only Source; this build migrates none of the
 * records of the earlier Sources, so an older database is refused and the operator starts a new state directory.
 */
export const SCHEMA_VERSION = 12
/** The oldest database schema version this build can open. */
export const OLDEST_SCHEMA = 12
/** Returns an error message explaining why `version` cannot be opened: older schemas need a new state directory. */
export const tooOld = (version: number): string =>
  `Orchestrator database schema ${version} predates schema ${OLDEST_SCHEMA}, which this version cannot migrate; start with a new state directory`
