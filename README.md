# wisent-texts

Every word a Wisent product shows a person, in every language the fleet
speaks: one list of languages, one layout a product keeps its words in, one
command that checks and translates them, one lookup in every runtime.

## Why this exists

Products printed their words as literals in their code, each in whatever
language its author wrote that day: a vault's consent dialog in Polish and
English glued together (`Zatwierdź / Approve`), a mobile app in Polish only,
a coding agent's conformance areas in Polish, its picker in 65 languages.
Jeden and wisent-app each kept their own list of the same languages. The
language of a word a person reads is not the product's choice; it is the
person's.

## What it holds, and what a product holds

- `languages.json` here: the fleet's languages by code, each with its English
  and native name, and the source language (`en`). A product never keeps its
  own list.
- `texts/` in the product's own repository, because a product owns its words:
  - `catalogue.json`: `{"product": NAME, "texts": {KEY: {"en": TEXT,
    "places": [VALUE...], "for": WHAT IT IS FOR}}}`. `places` names every
    `{value}` the text places; `for` is what a translator reads as context.
  - `translations/<code>.json`: every key in that language.
  - `bundle.json`: what the product's runtime reads, written by `texts bundle`
    and `texts translate`.

## Commands

Run from the product's repository (or name the directory with `--root`):

```bash
node ../wisent-texts/bin/texts.mjs check [--language CODE]... [--allow-missing]
node ../wisent-texts/bin/texts.mjs missing
node ../wisent-texts/bin/texts.mjs translate [--language CODE]...
node ../wisent-texts/bin/texts.mjs attest --answers DIR --checked TEXT [--language CODE]...
node ../wisent-texts/bin/texts.mjs bundle [--check]
```

- `check` refuses, naming each: a key without English; a text that places a
  value its entry does not name, or names one it does not place; a
  translation that drops or adds a placed value, is empty, or translates a key
  the catalogue does not hold; a translation file for a language
  `languages.json` does not hold; a language that lacks a key (unless
  `--allow-missing`); a `bundle.json` that no longer matches.
- `missing` lists, per language, the keys it lacks.
- `translate` asks for the keys each language lacks, one request per
  language, through `stado capabilities call inference --consumer
  wisent-texts`: Stado hands the request to the first alternative that answers
  (Brama, or a statement the operator recorded for that exact request with
  `stado capabilities attestation record`). An answer that is not one JSON
  object, misses or adds a key, or drops a placed value is refused naming the
  key, and nothing of that language is written. Every language is asked in
  one run; a language no alternative answered is named with Stado's message
  (each alternative and its cause) and the request Stado kept for it, the
  others are written, and the command ends non-zero. `STADO_BIN` names
  another stado executable.
- `attest` answers the requests no alternative answered with statements: for
  each language it reads `DIR/<code>.json` (that language's keys) and any
  `DIR/<key>.json` (one key in every language, `{code: text}`; a key both
  answer in different words is refused), checks it as an alternative's
  answer is checked (every asked key, every placed value, nothing added),
  records it with `stado capabilities attestation record --checked TEXT` as
  the statement for exactly that language's request, then translates, so what
  is written is what Stado's alternatives answer. An answer that fails the
  check is refused naming the key and nothing is recorded; a language an
  alternative already answers needs no statement and none is recorded.
- `bundle` writes `bundle.json` from the catalogue and translations; with
  `--check` it refuses a stale one, which is what a product's CI runs.

## Runtimes

`rust/` (`wisent_texts::Texts`), `js/texts.mjs` and the Swift package
`WisentTexts` (`Texts(bundle:)`, `say(_:in:_:)`) read `bundle.json`. A
product embeds it at build time (`Texts::bundle(include_str!(...))`, an
`import` of the JSON, or a SwiftPM resource) and asks it for a key in a
language. `wisent_texts::languages()` is the fleet's list for a product that
offers its reader a choice.
without the key, or one the fleet does not speak, reads English; a key the
bundle does not hold answers the key itself, so a missing word is visible, and
`check` refuses it before it ships.

The language a person reads is theirs: a product takes it from its own
setting, else from the operating system (`LC_ALL`, `LC_MESSAGES`, `LANG`,
`AppleLanguages`) through `wisent_texts::language()`.

## Real test

`node tests/journey.mjs [--language CODE]` builds an isolated texts directory
of two keys under `target/real-tests`, runs each refusal of `check`, runs
`translate` against the real alternatives for one language, reads the result
back through the JS runtime, refuses a stale bundle, then removes what it made
and keeps the report. When no alternative answers it ends BLOCKED (exit 2),
never passed. `cargo test -p wisent-texts` covers the Rust lookup.
