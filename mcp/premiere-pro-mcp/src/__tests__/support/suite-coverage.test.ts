/**
 * Guard: no test file can silently stop running. Jest only runs files named
 * *.test.ts under src/ (jest.config.js), so a misnamed file ("foo.tests.ts",
 * "foo.spec.js") would be skipped without a word. Every .ts file under
 * __tests__ must be either a test or a helper that some test imports.
 */

import fs from 'node:fs';
import path from 'node:path';

const TESTS_DIR = path.resolve(process.cwd(), 'src', '__tests__');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    return d.isDirectory() ? walk(full) : [full];
  });
}

describe('test suite coverage', () => {
  const files = walk(TESTS_DIR);
  const tests = files.filter((f) => f.endsWith('.test.ts'));
  const others = files.filter((f) => !f.endsWith('.test.ts'));

  it('finds the test files', () => {
    expect(tests.length).toBeGreaterThan(20);
  });

  it('has no file under __tests__ that Jest would skip', () => {
    const imported = new Set<string>();
    for (const t of tests) {
      const src = fs.readFileSync(t, 'utf8');
      for (const m of src.matchAll(/from ['"](\.[^'"]+)['"]/g)) {
        imported.add(path.resolve(path.dirname(t), m[1]!.replace(/\.js$/, '.ts')));
      }
    }
    // Wired in by jest.config.js rather than imported.
    const configured = new Set([path.join(TESTS_DIR, 'support', 'setup-env.ts'), path.join(TESTS_DIR, 'support', 'package-root.ts')]);
    const skipped = others.filter((f) => !imported.has(f) && !configured.has(f)).map((f) => path.relative(TESTS_DIR, f));
    expect(skipped).toEqual([]);
  });
});
