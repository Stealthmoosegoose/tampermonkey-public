// Rebuilds canvas-a11y-flagger.bookmarklet.txt (the standalone, non-updating bookmarklet)
// from canvas-a11y-flagger.user.js. Only needed if Canvas blocks the auto-updating loader.
// Run from this folder:  npm install --no-save terser && node build-bookmarklet.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { minify } from 'terser';

const src = readFileSync('canvas-a11y-flagger.user.js', 'utf8');
const { code } = await minify('window.__a11yfOnDemand=true;' + src, {
  compress: true, mangle: true, format: { comments: false },
});
const url = 'javascript:' + encodeURIComponent(code);
writeFileSync('canvas-a11y-flagger.bookmarklet.txt', url + '\n');
console.log(`Wrote canvas-a11y-flagger.bookmarklet.txt (${url.length} characters)`);
