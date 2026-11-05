#!/usr/bin/env node
// The real journey of wisent-texts: an isolated product catalogue of two keys
// under target/real-tests, `check` on a correct catalogue and on each shape it
// refuses, `translate` of one language through the real alternatives Stado
// selects, and the written file read back. Everything the run made is removed
// at the end; the report (revision, commands, exit statuses, outputs) stays.
//
//   node tests/journey.mjs [--language <code>]
//
// A translation no alternative can answer ends the run as blocked, naming
// Stado's message; it is never reported as passed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const language = argv[argv.indexOf('--language') + 1] && argv.includes('--language') ? argv[argv.indexOf('--language') + 1] : 'pl';
const run = `${new Date().toISOString().replace(/[:.]/g, '')}-${process.pid}`;
const home = join(root, 'target', 'real-tests', 'journey', run);
const data = join(home, 'data');
const report = join(home, 'report.txt');
mkdirSync(data, { recursive: true });
const revision = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim() || 'uncommitted';
writeFileSync(report, `revision: ${revision}\n`);

function texts(...args) {
  const done = spawnSync(process.execPath, [join(root, 'bin', 'texts.mjs'), '--root', data, ...args], { encoding: 'utf8' });
  appendFileSync(report, `$ texts ${args.join(' ')}\nexit: ${done.status}\nstdout: ${done.stdout}\nstderr: ${done.stderr}\n\n`);
  return done;
}
function refused(done, words) {
  assert.notEqual(done.status, 0, `expected a refusal containing «${words}»`);
  assert.ok(done.stderr.includes(words), `expected «${words}» in: ${done.stderr}`);
  appendFileSync(report, `ok: refused with «${words}»\n`);
}

writeFileSync(join(data, 'languages.json'), readFileSync(join(root, 'languages.json')));
mkdirSync(join(data, 'catalogue'));
const catalogue = {
  product: 'journey',
  texts: {
    'dialog.approve': { en: 'Approve', for: 'the button that grants an access request' },
    'dialog.hours': { en: 'For {hours} hours', places: ['hours'], for: 'how long a grant lasts' },
  },
};
const write = (path, value) => {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
};
const cataloguePath = join(data, 'catalogue', 'journey.json');
const languagePath = join(data, 'translations', 'journey', `${language}.json`);
write(cataloguePath, catalogue);

try {
  // A catalogue whose text places a value it does not declare.
  write(cataloguePath, { ...catalogue, texts: { ...catalogue.texts, 'dialog.hours': { en: 'For {hours} hours', for: 'x' } } });
  refused(texts('check', 'journey', '--allow-missing'), 'places {hours}');
  write(cataloguePath, catalogue);

  // A translation that drops a placed value, and one of a key the catalogue lacks.
  write(languagePath, { 'dialog.approve': 'x', 'dialog.hours': 'no value' });
  refused(texts('check', 'journey', '--allow-missing'), 'drops {hours}');
  write(languagePath, { 'dialog.approve': 'x', 'dialog.hours': '{hours}', 'dialog.other': 'y' });
  refused(texts('check', 'journey', '--allow-missing'), 'dialog.other');
  rmSync(languagePath);

  // A language the fleet does not speak.
  write(join(data, 'translations', 'journey', 'xx.json'), {});
  refused(texts('check', 'journey', '--allow-missing'), 'xx');
  rmSync(join(data, 'translations', 'journey', 'xx.json'));

  // Every language lacks both keys before translation.
  refused(texts('check', 'journey'), 'lacks');
  const missing = texts('missing', 'journey');
  assert.equal(missing.status, 0, missing.stderr);
  assert.ok(missing.stdout.includes(`${language}: dialog.approve, dialog.hours`), missing.stdout);

  // The real translation of one language through Stado's alternatives.
  const translated = texts('translate', 'journey', '--language', language);
  if (translated.status !== 0) {
    appendFileSync(report, 'BLOCKED: no alternative translated the catalogue\n');
    console.error(`BLOCKED: ${translated.stderr.trim()}\nreport: ${report}`);
    process.exit(2);
  }
  const written = JSON.parse(readFileSync(languagePath, 'utf8'));
  assert.deepEqual(Object.keys(written).sort(), ['dialog.approve', 'dialog.hours']);
  assert.ok(written['dialog.hours'].includes('{hours}'), written['dialog.hours']);
  assert.notEqual(written['dialog.approve'], 'Approve');
  const checked = texts('check', 'journey', '--language', language);
  assert.equal(checked.status, 0, checked.stderr);
  appendFileSync(report, 'PASS\n');
  console.log(`PASS: ${report}`);
} finally {
  rmSync(data, { recursive: true, force: true });
  assert.ok(!existsSync(data));
}
