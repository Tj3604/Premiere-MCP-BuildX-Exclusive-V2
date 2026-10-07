/**
 * Test stand-in for src/utils/package-root.ts (mapped in jest.config.js): same
 * values, found without import.meta. Jest runs from the package folder.
 */

import path from 'node:path';

export const PACKAGE_ROOT = path.resolve(process.cwd());
export const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
