# wisent-texts

Every word a Wisent product shows a person, in every language the fleet
speaks: one catalogue per product, one list of languages, one translation
command, one lookup in every runtime.

## Why this exists

Products printed their words as literals in their code, each in whatever
language its author wrote that day: a vault's consent dialog in Polish and
English glued together (`Zatwierdź / Approve`), a grant tool's documents in
Polish only, a coding agent's conformance areas in Polish, its picker in 65
languages. Jeden and wisent-app each kept their own list of the same 65
languages. A word a person reads is not the product's choice of language; it
is the person's.

## What it holds

- `languages.json` — the fleet's languages, by code, with each one's English
  and native name. A product never keeps its own list.
- `catalogue/<product>.json` — one product's texts: each key with its English
  source, the values it places (`{name}`) and what it is for, so a translator
  reads the context, not a bare string.
- `translations/<product>/<language>.json` — every key of the product in that
  language. English is the source and needs no file.

## Commands

```bash
node bin/texts.mjs check [<product>]
node bin/texts.mjs translate <product> [--language <code>]...
node bin/texts.mjs missing <product>
```

- `check` refuses, naming each, a catalogue key without English, a key whose
  text places a value its catalogue entry does not name, a translation that
  drops or adds a placed value, a translation of a key the catalogue does not
  hold, a language file for a language `languages.json` does not hold, and a
  language with no translation of a key (unless `--allow-missing`).
- `translate` asks for every key a language lacks, one request per language,
  through `stado capabilities call inference --consumer wisent-texts`: Stado
  hands it to the first alternative that answers (Brama, or a statement the
  operator recorded for that exact request). The answer is checked as `check`
  checks a file before anything is written; an answer that drops a placed
  value, adds a key or misses one is refused naming the key, and nothing of
  that language is written. When no alternative answers, the command stops
  with Stado's message, which names each alternative and its cause.
- `missing` lists, per language, the keys it lacks.

## Runtimes

`rust/` (`wisent_texts::Texts`) and `js/texts.mjs` read the same files. A
product embeds its catalogue and translations at build time
(`Texts::embedded` with `include_str!`), and asks
`texts.say(language, key, &[(name, value)])`. A language without the key, or
one the fleet does not speak, reads English; a key without English is a
defect, refused by `check` before it ships.

The language a person reads is theirs: a product takes it from its own
setting, else from the operating system (`LC_ALL`, `LC_MESSAGES`, `LANG`,
`AppleLanguages`), through `wisent_texts::language()`.

## Real test

`node tests/journey.mjs` builds an isolated catalogue of two keys, runs
`check` on a correct and on each refused shape, runs `translate` against the
real alternatives for one language and checks the written file, then removes
everything it made.
