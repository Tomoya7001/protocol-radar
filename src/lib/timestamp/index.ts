export {
  ANCHORS_DIR,
  isValidHeadHash,
  otsFileName,
  otsRelPath,
  detachedForHead,
  serializeProof,
  deserializeProof,
  classifyAttestations,
  parseOtsProof,
} from "./ots";
export type {
  TimestampStatus,
  BitcoinAttestationInfo,
  OtsProofInfo,
} from "./ots";
export {
  buildTimestamp,
  buildTimestampResponse,
  __setOtsReaderForTests,
} from "./build";
export type { TimestampResponse } from "./build";
