#!/usr/bin/env node
// The wisent-texts command. A product owns its words in its own repository,
// under texts/: catalogue.json (its English texts) and translations/<code>.json
// (each language); this command checks them against the fleet's languages,
// lists what a language lacks, translates it through Stado's central
// alternatives, and writes bundle.json, the one file a product's runtime
// reads. README.md states the contract.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const usage = `usage:
  texts [--root DIR] check [--language CODE]... [--allow-missing]
  texts [--root DIR] missing
  texts [--root DIR] translate [--language CODE]...
  texts [--root DIR] bundle [--check]
DIR is the product's texts directory, ./texts by default.`;

function fail(message, code = 1) {
  console.error(`texts: ${message}`);
  process.exit(code);
}

const args = process.argv.slice(2);
const take = (flag) => {
  const values = [];
  for (let at = args.indexOf(flag); at !== -1; at = args.indexOf(flag)) {
    if (at + 1 >= args.length) fail(`${flag} needs a value\n${usage}`, 2);
    values.push(args[at + 1]);
    args.splice(at, 2);
  }
  return values;
};
const root = resolve(take('--root').at(-1) ?? 'texts');
const languagesWanted = take('--language');
const flags = new Set(args.filter((word) => word.startsWith('--')));
for (const flag of flags) if (!['--allow-missing', '--check'].includes(flag)) fail(`unknown option ${flag}\n${usage}`, 2);
const [verb, extra] = args.filter((word) => !word.startsWith('--'));
if (extra) fail(`unexpected ${extra}\n${usage}`, 2);

const read = (path, what) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${what} ${path} cannot be read as JSON: ${error.message}`);
  }
};
const fleet = read(resolve(import.meta.dirname, '..', 'languages.json'), 'the fleet language list');
const codes = new Set(fleet.languages.map((language) => language.code));
const source = fleet.source;
const placed = (text) => [...String(text).matchAll(/\{([a-z_][a-z0-9_]*)\}/g)].map((match) => match[1]).sort();
const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

const cataloguePath = join(root, 'catalogue.json');
if (!existsSync(cataloguePath)) fail(`no catalogue at ${cataloguePath}; a product keeps its texts in texts/catalogue.json, or --root names the directory`);
const catalogue = read(cataloguePath, 'the catalogue');
const product = catalogue.product;
if (typeof product !== 'string' || !product) fail(`${cataloguePath} names no product`);
const entries = Object.entries(catalogue.texts ?? {});
const translationDir = join(root, 'translations');
const translationOf = (code) => {
  const path = join(translationDir, `${code}.json`);
  return existsSync(path) ? read(path, 'the translation') : {};
};
const others = [...codes].filter((code) => code !== source);

/// Every problem of the catalogue and its translations.
function problems(onlyLanguages, missingAllowed) {
  const found = [];
  for (const [key, entry] of entries) {
    if (typeof entry[source] !== 'string' || !entry[source].trim()) {
      found.push(`key ${key} has no ${source} text`);
      continue;
    }
    const declared = [...(entry.places ?? [])].sort();
    for (const value of placed(entry[source])) {
      if (!declared.includes(value)) found.push(`key ${key} places {${value}}, which its entry does not name in places`);
    }
    for (const value of declared) {
      if (!placed(entry[source]).includes(value)) found.push(`key ${key} names {${value}} in places, which its text does not place`);
    }
  }
  const files = existsSync(translationDir) ? readdirSync(translationDir).filter((file) => file.endsWith('.json')) : [];
  for (const file of files) {
    const code = file.slice(0, -'.json'.length);
    if (!codes.has(code) || code === source) found.push(`translations/${file} is for ${code}, which is not a language to translate into (languages.json)`);
  }
  for (const code of onlyLanguages.length ? onlyLanguages : others) {
    if (!others.includes(code)) {
      found.push(`${code} is not a language to translate into (languages.json)`);
      continue;
    }
    const translation = translationOf(code);
    for (const [key, text] of Object.entries(translation)) {
      const entry = catalogue.texts?.[key];
      if (!entry) {
        found.push(`${code}: translates key ${key}, which the catalogue does not hold`);
        continue;
      }
      if (typeof text !== 'string' || !text.trim()) {
        found.push(`${code}: key ${key} is not a nonempty string`);
        continue;
      }
      const want = placed(entry[source] ?? '');
      const got = placed(text);
      for (const value of want) if (!got.includes(value)) found.push(`${code}: key ${key} drops {${value}}`);
      for (const value of got) if (!want.includes(value)) found.push(`${code}: key ${key} adds {${value}}`);
    }
    if (!missingAllowed) {
      const lacks = entries.map(([key]) => key).filter((key) => !(key in translation));
      if (lacks.length) found.push(`${code}: lacks ${lacks.length} key(s): ${lacks.slice(0, 5).join(', ')}${lacks.length > 5 ? ', …' : ''}`);
    }
  }
  return found;
}

function bundle() {
  const translations = {};
  for (const code of others) {
    const translation = translationOf(code);
    if (Object.keys(translation).length) translations[code] = translation;
  }
  return `${JSON.stringify({ product, source, texts: Object.fromEntries(entries.map(([key, entry]) => [key, entry[source]])), translations }, null, 1)}\n`;
}

function translateLanguage(code) {
  const language = fleet.languages.find((entry) => entry.code === code);
  const current = translationOf(code);
  const wanted = entries.filter(([key]) => !(key in current));
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
  if (answered.error) throw new Error(`${stado} cannot run: ${answered.error.message}; STADO_BIN names another stado executable`);
  if (answered.status !== 0) {
    const said = answered.stderr.split('\n').filter((line) => line.startsWith('Error:')).join('\n') || answered.stderr.trim();
    throw new Error(`${stado} capabilities call inference --consumer wisent-texts exited ${answered.status}, nothing of ${code} was written:\n${said}`);
  }
  let content;
  try {
    content = JSON.parse(answered.stdout).choices?.[0]?.message?.content ?? '';
  } catch (error) {
    throw new Error(`the answer is not a chat-completions response: ${error.message}`);
  }
  let translated;
  try {
    translated = JSON.parse(String(content).replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch (error) {
    throw new Error(`the translation is not one JSON object: ${error.message}; nothing of ${code} was written`);
  }
  const wrong = [];
  for (const [key, entry] of wanted) {
    const text = translated[key];
    if (typeof text !== 'string' || !text.trim()) {
      wrong.push(`misses ${key}`);
      continue;
    }
    const want = placed(entry[source]);
    if (!same(want, placed(text))) wrong.push(`${key} places {${placed(text).join('}, {')}} instead of {${want.join('}, {')}}`);
  }
  for (const key of Object.keys(translated)) if (!items[key]) wrong.push(`adds ${key}, which was not asked`);
  if (wrong.length) throw new Error(`the translation was refused, nothing of ${code} was written: ${wrong.join('; ')}`);
  const merged = { ...current };
  for (const [key] of wanted) merged[key] = translated[key];
  const path = join(translationDir, `${code}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((key) => [key, merged[key]])), null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
  return `${code}: ${wanted.length} key(s) translated`;
}

switch (verb) {
  case 'check': {
    const found = problems(languagesWanted, flags.has('--allow-missing'));
    const bundled = join(root, 'bundle.json');
    if (existsSync(bundled) && readFileSync(bundled, 'utf8') !== bundle()) found.push('bundle.json does not match the catalogue and translations; run texts bundle');
    if (found.length) fail(`${product}: ${found.length} problem(s):\n${found.join('\n')}`);
    console.log(`${product}: ok, ${entries.length} key(s) in ${(languagesWanted.length ? languagesWanted : others).length} language(s)`);
    break;
  }
  case 'missing':
    for (const code of others) {
      const translation = translationOf(code);
      const lacks = entries.map(([key]) => key).filter((key) => !(key in translation));
      if (lacks.length) console.log(`${code}: ${lacks.join(', ')}`);
    }
    break;
  case 'translate': {
    const before = problems(languagesWanted, true);
    if (before.length) fail(`${product}: the catalogue and translations must pass check first:\n${before.join('\n')}`);
    // Every language is asked, so one run files the request of each; a
    // language that was not answered or was refused is named with its cause
    // and the command ends non-zero once the others are written.
    const failed = [];
    for (const code of languagesWanted.length ? languagesWanted : others) {
      try {
        console.log(translateLanguage(code));
      } catch (error) {
        failed.push(`${code}: ${error.message}`);
      }
    }
    writeFileSync(join(root, 'bundle.json'), bundle());
    if (failed.length) fail(`${product}: ${failed.length} language(s) not translated:\n${failed.join('\n')}`);
    break;
  }
  case 'bundle': {
    const path = join(root, 'bundle.json');
    const fresh = bundle();
    if (flags.has('--check')) {
      if (!existsSync(path) || readFileSync(path, 'utf8') !== fresh) fail(`${path} does not match the catalogue and translations; run texts bundle`);
      console.log(`${product}: bundle.json is current`);
      break;
    }
    const found = problems([], true);
    if (found.length) fail(`${product}: ${found.length} problem(s):\n${found.join('\n')}`);
    writeFileSync(path, fresh);
    console.log(`${product}: wrote ${path}`);
    break;
  }
  default:
    fail(usage, 2);
}
