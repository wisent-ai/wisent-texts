#!/usr/bin/env node
// The wisent-texts command: check a product's catalogue and translations,
// list what each language lacks, and translate what it lacks through Stado's
// central alternatives. README.md states the contract.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const usage = `usage:
  texts [--root DIR] check [<product>] [--language CODE]... [--allow-missing]
  texts [--root DIR] missing <product>
  texts [--root DIR] translate <product> [--language CODE]...`;

function fail(message, code = 1) {
  console.error(`texts: ${message}`);
  process.exit(code);
}

const args = process.argv.slice(2);
let root = resolve(import.meta.dirname, '..');
const take = (flag) => {
  const values = [];
  for (let at = args.indexOf(flag); at !== -1; at = args.indexOf(flag)) {
    if (at + 1 >= args.length) fail(`${flag} needs a value\n${usage}`, 2);
    values.push(args[at + 1]);
    args.splice(at, 2);
  }
  return values;
};
const rootFlag = take('--root');
if (rootFlag.length) root = resolve(rootFlag.at(-1));
const languagesWanted = take('--language');
const allowMissing = args.includes('--allow-missing');
const positional = args.filter((word) => word !== '--allow-missing');
const [verb, product] = positional;

const read = (path, what) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${what} ${path} cannot be read as JSON: ${error.message}`);
  }
};
const fleet = read(join(root, 'languages.json'), 'the language list');
const codes = new Set(fleet.languages.map((language) => language.code));
const source = fleet.source;
const placed = (text) => [...text.matchAll(/\{([a-z_][a-z0-9_]*)\}/g)].map((match) => match[1]).sort();
const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

function catalogueOf(name) {
  const path = join(root, 'catalogue', `${name}.json`);
  if (!existsSync(path)) fail(`no catalogue for product ${name} (${path})`);
  return read(path, 'the catalogue');
}
const translationDir = (name) => join(root, 'translations', name);
const translationOf = (name, code) => {
  const path = join(translationDir(name), `${code}.json`);
  return existsSync(path) ? read(path, 'the translation') : {};
};

/// Every problem of one product's catalogue and translations.
function problems(name, onlyLanguages) {
  const found = [];
  const catalogue = catalogueOf(name);
  for (const [key, entry] of Object.entries(catalogue.texts ?? {})) {
    if (typeof entry[source] !== 'string' || !entry[source].trim()) {
      found.push(`${name}: key ${key} has no ${source} text`);
      continue;
    }
    const declared = [...(entry.places ?? [])].sort();
    for (const value of placed(entry[source])) {
      if (!declared.includes(value)) found.push(`${name}: key ${key} places {${value}}, which its entry does not name in places`);
    }
  }
  const dir = translationDir(name);
  const files = existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.json')) : [];
  for (const file of files) {
    const code = file.slice(0, -'.json'.length);
    if (!codes.has(code)) found.push(`${name}: translations/${name}/${file} is for ${code}, a language languages.json does not hold`);
  }
  const languages = (onlyLanguages.length ? onlyLanguages : [...codes]).filter((code) => code !== source);
  for (const code of languages) {
    if (!codes.has(code)) {
      found.push(`${code} is not a language languages.json holds`);
      continue;
    }
    const translation = translationOf(name, code);
    for (const [key, text] of Object.entries(translation)) {
      const entry = catalogue.texts?.[key];
      if (!entry) {
        found.push(`${name}/${code}: translates key ${key}, which the catalogue does not hold`);
        continue;
      }
      const want = placed(entry[source] ?? '');
      const got = placed(String(text));
      for (const value of want) if (!got.includes(value)) found.push(`${name}/${code}: key ${key} drops {${value}}`);
      for (const value of got) if (!want.includes(value)) found.push(`${name}/${code}: key ${key} adds {${value}}`);
    }
    if (!allowMissing) {
      const lacks = Object.keys(catalogue.texts ?? {}).filter((key) => !(key in translation));
      if (lacks.length) found.push(`${name}/${code}: lacks ${lacks.length} key(s): ${lacks.slice(0, 5).join(', ')}${lacks.length > 5 ? ', …' : ''}`);
    }
  }
  return found;
}

function check() {
  const products = product
    ? [product]
    : (existsSync(join(root, 'catalogue')) ? readdirSync(join(root, 'catalogue')) : [])
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.slice(0, -'.json'.length));
  const found = products.flatMap((name) => problems(name, languagesWanted));
  if (found.length) fail(`${found.length} problem(s):\n${found.join('\n')}`);
  console.log(`ok: ${products.join(', ') || 'no catalogue'}`);
}

function missing() {
  if (!product) fail(usage, 2);
  const catalogue = catalogueOf(product);
  const keys = Object.keys(catalogue.texts ?? {});
  for (const code of [...codes].filter((code) => code !== source)) {
    const translation = translationOf(product, code);
    const lacks = keys.filter((key) => !(key in translation));
    if (lacks.length) console.log(`${code}: ${lacks.join(', ')}`);
  }
}

/// One language's missing keys, translated through Stado's alternatives and
/// checked before anything is written.
function translateLanguage(catalogue, code) {
  const language = fleet.languages.find((entry) => entry.code === code);
  const current = translationOf(product, code);
  const wanted = Object.entries(catalogue.texts ?? {}).filter(([key]) => !(key in current));
  if (!wanted.length) return `${code}: nothing to translate`;
  const items = Object.fromEntries(
    wanted.map(([key, entry]) => [key, { text: entry[source], for: entry.for ?? '', keep: placed(entry[source]).map((value) => `{${value}}`) }]),
  );
  const request = {
    messages: [
      {
        role: 'system',
        content:
          `You translate the interface texts of the software product ${product} from English into ${language.english} (${language.native}, ${code}). ` +
          'Answer with one JSON object only: each key of the request mapped to its translation as a string. ' +
          'Keep every placeholder written in braces exactly as it is, never translate product names or technical identifiers, ' +
          'and write as a native speaker writes an interface: short, plain, the same register as the English.',
      },
      { role: 'user', content: JSON.stringify(items) },
    ],
    response_format: { type: 'json_object' },
  };
  const stado = process.env.STADO_BIN || 'stado';
  const answered = spawnSync(stado, ['capabilities', 'call', 'inference', '--consumer', 'wisent-texts'], {
    input: JSON.stringify(request),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (answered.error) fail(`${code}: ${stado} cannot run: ${answered.error.message}; STADO_BIN names another stado executable`);
  if (answered.status !== 0) fail(`${code}: ${stado} capabilities call inference --consumer wisent-texts exited ${answered.status}: ${answered.stderr.trim()}`);
  let content;
  try {
    const reply = JSON.parse(answered.stdout);
    content = reply.choices?.[0]?.message?.content ?? '';
  } catch (error) {
    fail(`${code}: the answer is not a chat-completions response: ${error.message}`);
  }
  let translated;
  try {
    translated = JSON.parse(String(content).replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch (error) {
    fail(`${code}: the translation is not one JSON object: ${error.message}; nothing of ${code} was written`);
  }
  const wrong = [];
  for (const [key, entry] of wanted) {
    const text = translated[key];
    if (typeof text !== 'string' || !text.trim()) {
      wrong.push(`misses ${key}`);
      continue;
    }
    const want = placed(entry[source]);
    if (!same(want, placed(text))) wrong.push(`${key} keeps {${placed(text).join('}, {')}} instead of {${want.join('}, {')}}`);
  }
  for (const key of Object.keys(translated)) if (!items[key]) wrong.push(`adds ${key}, which was not asked`);
  if (wrong.length) fail(`${code}: the translation was refused, nothing of ${code} was written: ${wrong.join('; ')}`);
  const merged = { ...current };
  for (const [key] of wanted) merged[key] = translated[key];
  const ordered = Object.fromEntries(Object.keys(merged).sort().map((key) => [key, merged[key]]));
  const path = join(translationDir(product), `${code}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(ordered, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
  return `${code}: ${wanted.length} key(s) translated`;
}

function translate() {
  if (!product) fail(usage, 2);
  const catalogue = catalogueOf(product);
  const before = problems(product, languagesWanted).filter((problem) => !problem.includes(' lacks '));
  if (before.length) fail(`the catalogue must pass check first:\n${before.join('\n')}`);
  const targets = (languagesWanted.length ? languagesWanted : [...codes]).filter((code) => code !== source);
  for (const code of targets) {
    if (!codes.has(code)) fail(`${code} is not a language languages.json holds`);
    console.log(translateLanguage(catalogue, code));
  }
}

switch (verb) {
  case 'check':
    check();
    break;
  case 'missing':
    missing();
    break;
  case 'translate':
    translate();
    break;
  default:
    fail(usage, 2);
}
