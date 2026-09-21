import type { NextConfig } from 'next';
import { existsSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.join(__dirname, '../..');
const deployedFromRepositoryRoot = existsSync(
  path.join(repositoryRoot, 'apps', 'admin', 'package.json'),
);

const nextConfig: NextConfig = {
  distDir: process.env.SUPPORTOS_NEXT_DIST_DIR || '.next',
  output: 'standalone',
  // The root Vercel project builds this app from the monorepo, while the
  // legacy admin project uploads apps/admin as its deployment root. Pointing
  // outside that smaller archive makes Vercel duplicate /vercel/path0 while
  // collecting routes-manifest.json, so choose the trace root from the actual
  // source layout rather than a fixed ../.. path.
  outputFileTracingRoot: deployedFromRepositoryRoot ? repositoryRoot : __dirname,
};

export default nextConfig;
