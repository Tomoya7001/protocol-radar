/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: ".next.nosync",
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingIncludes: {
    "/**": ["./data/snapshot.db"],
  },
};
export default nextConfig;
