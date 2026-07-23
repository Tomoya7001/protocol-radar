/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.VERCEL ? '.next' : '.next.nosync',
  // better-sqlite3 is native; opentimestamps (+ its request/bitcore-lib deps) uses dynamic
  // requires that webpack should not try to bundle. Both are required at runtime on Node.
  serverExternalPackages: ["better-sqlite3", "opentimestamps"],
  outputFileTracingIncludes: {
    // Bundle the read-only snapshot AND the committed OpenTimestamps proofs so the
    // GET /api/timestamp handler can read `data/anchors/<head>.ots` on a read-only deploy.
    "/**": ["./data/snapshot.db", "./data/anchors/**"],
  },
};
export default nextConfig;
