#!/usr/bin/env node
// The real journey of wisent-texts: an isolated product texts directory of two
// keys under target/real-tests, `check` on each shape it refuses, `missing`,
// `translate` of one language through the real alternatives Stado selects,
// the written translation and bundle read back through the JS runtime, and
// `bundle --check` refusing a stale bundle. Everything the run made is removed
// at the end; the report (revision, commands, exit statuses, outputs) stays.
//
//   node tests/journey.mjs [--language <code>]
//
// A translation no alternative answers ends the run as BLOCKED (exit 2),
// naming Stado's message; it is never reported as passed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { texts as runtime } from '../js/texts.mjs';

const root = resolve(import.meta.dirname, '..');
const at = process.argv.indexOf('--language');
const language = at !== -1 ? process.argv[at + 1] : 'pl';
const run = `${new Date().toISOString().replace(/[:.]/g, '')}-${process.pid}`;
const home = join(root, 'target', 'real-tests', 'journey', run);
const data = join(home, 'texts');
const report = join(home, 'report.txt');
mkdirSync(data, { recursive: true });
const revision = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const dirty = spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).stdout.trim();
writeFileSync(report, `revision: ${revision}${dirty ? ' (with uncommitted changes)' : ''}\n`);

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
const write = (path, value) => {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
};

const catalogue = {
  product: 'journey',
  texts: {
    'dialog.approve': { en: 'Approve', for: 'the button that grants an access request' },
    'dialog.hours': { en: 'For {hours} hours', places: ['hours'], for: 'how long a grant lasts' },
  },
};
const cataloguePath = join(data, 'catalogue.json');
const languagePath = join(data, 'translations', `${language}.json`);

try {
  write(cataloguePath, { ...catalogue, texts: { ...catalogue.texts, 'dialog.hours': { en: 'For {hours} hours', for: 'x' } } });
  refused(texts('check', '--allow-missing'), 'places {hours}');
  write(cataloguePath, catalogue);

  write(languagePath, { 'dialog.approve': 'x', 'dialog.hours': 'no value' });
  refused(texts('check', '--allow-missing'), 'drops {hours}');
  write(languagePath, { 'dialog.approve': 'x', 'dialog.hours': '{hours}', 'dialog.other': 'y' });
  refused(texts('check', '--allow-missing'), 'dialog.other');
  rmSync(languagePath);

  write(join(data, 'translations', 'xx.json'), {});
  refused(texts('check', '--allow-missing'), 'xx');
  rmSync(join(data, 'translations', 'xx.json'));

  refused(texts('check'), 'lacks');
  const missing = texts('missing');
  assert.equal(missing.status, 0, missing.stderr);
  assert.ok(missing.stdout.includes(`${language}: dialog.approve, dialog.hours`), missing.stdout);

  const translated = texts('translate', '--language', language);
  if (translated.status !== 0) {
    appendFileSync(report, 'BLOCKED: no alternative translated the catalogue\n');
    console.error(`BLOCKED: ${translated.stderr.trim()}\nreport: ${report}`);
    process.exitCode = 2;
  } else {
    const written = JSON.parse(readFileSync(languagePath, 'utf8'));
    assert.deepEqual(Object.keys(written).sort(), ['dialog.approve', 'dialog.hours']);
    const said = runtime(JSON.parse(readFileSync(join(data, 'bundle.json'), 'utf8')));
    assert.equal(said.say(language, 'dialog.hours', { hours: 3 }), written['dialog.hours'].replace('{hours}', '3'));
    assert.equal(said.say('xx', 'dialog.approve'), 'Approve');
    assert.equal(texts('check', '--language', language).status, 0);

    write(cataloguePath, { ...catalogue, texts: { ...catalogue.texts, 'dialog.extra': { en: 'Extra', for: 'a key added after the bundle was written' } } });
    refused(texts('bundle', '--check'), 'does not match');

    // A language no alternative has answered yet: a statement that drops a
    // placed value is refused and nothing is recorded; a checked one is
    // recorded with Stado for exactly this request and written. The run id
    // makes the request new, so no earlier statement answers it.
    write(cataloguePath, { ...catalogue, texts: { ...catalogue.texts, 'dialog.deny': { en: `Deny {who} ${run}`, places: ['who'], for: 'the refusing button, naming who denies' } } });
    const answers = join(home, 'answers');
    write(join(answers, `${language}.json`), { 'dialog.deny': 'no value' });
    refused(texts('attest', '--answers', answers, '--checked', 'journey statement', '--language', language), 'instead of {who}');
    write(join(answers, `${language}.json`), { 'dialog.deny': `Odmów {who} ${run}` });
    const attested = texts('attest', '--answers', answers, '--checked', 'journey statement', '--language', language);
    assert.equal(attested.status, 0, attested.stderr);
    assert.ok(attested.stdout.includes('statement recorded for request'), attested.stdout);
    assert.equal(JSON.parse(readFileSync(languagePath, 'utf8'))['dialog.deny'], `Odmów {who} ${run}`);
    rmSync(answers, { recursive: true, force: true });
    appendFileSync(report, 'PASS\n');
    console.log(`PASS: ${report}`);
  }
} finally {
  rmSync(data, { recursive: true, force: true });
  assert.ok(!existsSync(data));
}
