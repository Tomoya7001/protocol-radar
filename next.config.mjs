/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.VERCEL ? '.next' : '.next.nosync',
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingIncludes: {
    "/**": ["./data/snapshot.db"],
  },
};
export default nextConfig;
