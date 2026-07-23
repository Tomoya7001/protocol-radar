/**
 * Public surface of the section-level spec-diff feature (F2). Re-exports the pure core and the
 * DB-wired request handler so callers import from "@/lib/specdiff" without reaching into files.
 */
export {
  diffSpecBodies,
  segmentSections,
  hasHeadings,
} from "./specdiff";
export type {
  ChangeKind,
  Granularity,
  SectionDiff,
  DiffHunk,
  SpecDiffSummary,
  SpecDiffResult,
} from "./specdiff";
export { handleSpecDiff } from "./response";
