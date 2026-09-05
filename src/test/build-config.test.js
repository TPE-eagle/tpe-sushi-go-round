import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Issue #122 regression guard: Vite 8 defaults build.cssMinify to
// lightningcss, which collapses an authored backdrop-filter /
// -webkit-backdrop-filter pair down to the -webkit- form regardless of the
// CSS target (upstream parcel-bundler/lightningcss#695). Firefox only
// supports the unprefixed property, so a silent minifier change is exactly
// how the frost was lost in the built stylesheet. Pin the CSS minifier to
// esbuild, which preserves authored prefixed/unprefixed pairs, and lock
// that decision in here.
describe('vite build config', () => {
  // vitest runs from the project root (jsdom env has no file:// base URL).
  const config = readFileSync(path.resolve(process.cwd(), 'vite.config.js'), 'utf8');

  it('pins cssMinify to esbuild so authored backdrop-filter pairs survive minification', () => {
    expect(config).toMatch(/cssMinify:\s*['"]esbuild['"]/);
  });
});
