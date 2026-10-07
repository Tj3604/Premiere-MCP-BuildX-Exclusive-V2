/**
 * The premiere-pro-mcp package folder, and the repo root above it.
 *
 * The one place that reads import.meta. Jest compiles these sources as CommonJS,
 * where import.meta is a syntax error, so jest.config.js maps this module to
 * src/__tests__/support/package-root.ts. Everything else imports from here.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// dist/utils/package-root.js (or src/utils/…) -> the package folder.
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// premiere-pro-mcp -> mcp -> repo root.
export const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
