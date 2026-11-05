// A product's words in the language its reader reads; the same contract as
// the Rust crate (rust/src/lib.rs). `catalogue` is catalogue/<product>.json,
// `translations` maps a language code to translations/<product>/<code>.json.
export function texts(catalogue, translations = {}) {
  const source = Object.fromEntries(
    Object.entries(catalogue.texts ?? {}).map(([key, entry]) => {
      if (typeof entry.en !== 'string') throw new Error(`catalogue key ${key} has no en text`);
      return [key, entry.en];
    }),
  );
  return {
    say(language, key, values = {}) {
      const code = String(language ?? 'en').split(/[-_.]/)[0].toLowerCase();
      let text = translations[code]?.[key] ?? source[key] ?? key;
      for (const [name, value] of Object.entries(values)) text = text.split(`{${name}}`).join(String(value));
      return text;
    },
  };
}
