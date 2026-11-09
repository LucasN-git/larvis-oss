import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BP, MQ } from '../src/theme/breakpoints';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

test('MQ strings follow from BP', () => {
  assert.equal(MQ.phone, `(max-width: ${BP.tablet - 1}px)`);
  assert.equal(MQ.tablet, `(min-width: ${BP.tablet}px) and (max-width: ${BP.desktop - 1}px)`);
  assert.equal(MQ.framed, `(min-width: ${BP.tablet}px)`);
  assert.equal(MQ.desktop, `(min-width: ${BP.desktop}px)`);
});

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

test('every viewport width query in CSS uses one of the shared breakpoints', () => {
  const allowed = new Set([BP.tablet - 1, BP.tablet, BP.desktop - 1, BP.desktop]);
  const offenders: string[] = [];
  const files = cssFiles(SRC);
  assert.ok(files.length > 0, 'no CSS files found');
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // Only @media; @container queries measure a column, not the viewport.
      for (const media of line.matchAll(/@media\b[^{]*/g)) {
        for (const m of media[0].matchAll(/\((?:min|max)-width:\s*(\d+(?:\.\d+)?)px\)/g)) {
          const n = Number(m[1]);
          if (!allowed.has(n)) offenders.push(`${relative(SRC, file)}:${i + 1} ${n}px`);
        }
      }
    });
  }
  assert.deepEqual(offenders, [], `width queries outside {639, 640, 1023, 1024}:\n${offenders.join('\n')}`);
});
