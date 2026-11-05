// A product's words in the language its reader reads; the same contract as
// the Rust crate (rust/src/lib.rs). `bundle` is the product's
// texts/bundle.json, written by `texts bundle`.
export function texts(bundle) {
  if (!bundle || typeof bundle.texts !== 'object') throw new Error('the bundle holds no texts object; write it with texts bundle');
  return {
    say(language, key, values = {}) {
      const code = String(language ?? bundle.source).split(/[-_.]/)[0].toLowerCase();
      let text = bundle.translations?.[code]?.[key] ?? bundle.texts[key] ?? key;
      for (const [name, value] of Object.entries(values)) text = text.split(`{${name}}`).join(String(value));
      return text;
    },
  };
}
