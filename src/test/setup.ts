/**
 * Global test setup. Runs before every test file.
 *
 * Tests must be deterministic and offline:
 *  - Fix the ledger HMAC secret so the hash-chain is reproducible and the ledger
 *    refuses-to-run guard is satisfied for the happy path. Individual tests that assert
 *    the "unset secret throws" behavior temporarily delete this and restore it.
 *  - Use an in-memory SQLite DB by default so no file is written and every test starts clean.
 */

process.env.PROTOCOL_RADAR_HMAC_SECRET =
  process.env.PROTOCOL_RADAR_HMAC_SECRET ??
  "test-hmac-secret-do-not-use-in-prod";

process.env.DATABASE_PATH = process.env.DATABASE_PATH ?? ":memory:";
