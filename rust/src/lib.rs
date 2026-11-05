//! A product's words in the language its reader reads.
//!
//! A product embeds its catalogue (`catalogue/<product>.json`) and its
//! translations (`translations/<product>/<code>.json`) at build time and asks
//! [`Texts::say`] for a key in a language. A language that lacks the key, or
//! that the fleet does not speak, reads English; a key the catalogue does not
//! hold is the product's defect and answers the key itself, so a missing word
//! is visible instead of blank. `node bin/texts.mjs check` refuses both
//! before a product ships.

use std::collections::HashMap;

/// One language's translation as embedded: its code and its JSON object.
pub type Embedded = (&'static str, &'static str);

/// A product's catalogue and every translation of it.
pub struct Texts {
    source: HashMap<String, String>,
    languages: HashMap<String, HashMap<String, String>>,
}

/// Why a catalogue or translation could not be read.
#[derive(Debug)]
pub struct Unreadable(pub String);

impl std::fmt::Display for Unreadable {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for Unreadable {}

impl Texts {
    /// The catalogue JSON and each translation, as `include_str!` embeds them.
    pub fn embedded(catalogue: &str, translations: &[Embedded]) -> Result<Self, Unreadable> {
        let parsed: serde_json::Value = serde_json::from_str(catalogue)
            .map_err(|error| Unreadable(format!("the catalogue is not JSON: {error}")))?;
        let entries = parsed
            .get("texts")
            .and_then(serde_json::Value::as_object)
            .ok_or_else(|| Unreadable("the catalogue has no texts object".into()))?;
        let mut source = HashMap::with_capacity(entries.len());
        for (key, entry) in entries {
            let english = entry
                .get("en")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| Unreadable(format!("catalogue key {key} has no en text")))?;
            source.insert(key.clone(), english.to_string());
        }
        let mut languages = HashMap::with_capacity(translations.len());
        for (code, body) in translations {
            let words: HashMap<String, String> = serde_json::from_str(body)
                .map_err(|error| Unreadable(format!("translation {code} is not a JSON object of strings: {error}")))?;
            languages.insert((*code).to_string(), words);
        }
        Ok(Self { source, languages })
    }

    /// The text of `key` in `language`, with each `{name}` replaced by its value.
    pub fn say(&self, language: &str, key: &str, values: &[(&str, &str)]) -> String {
        let text = self
            .languages
            .get(base(language))
            .and_then(|words| words.get(key))
            .or_else(|| self.source.get(key))
            .map(String::as_str)
            .unwrap_or(key);
        let mut said = text.to_string();
        for (name, value) in values {
            said = said.replace(&format!("{{{name}}}"), value);
        }
        said
    }
}

/// `pl-PL`, `pl_PL.UTF-8` and `pl` all read `pl`.
fn base(language: &str) -> &str {
    language.split(['-', '_', '.']).next().unwrap_or(language)
}

/// The language the person at this machine reads: `LC_ALL`, `LC_MESSAGES`,
/// `LANG`, then on macOS the first of `AppleLanguages`; English otherwise.
pub fn language() -> String {
    for name in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(value) = std::env::var(name) {
            let code = base(&value).to_ascii_lowercase();
            if !code.is_empty() && code != "c" && code != "posix" {
                return code;
            }
        }
    }
    #[cfg(target_os = "macos")]
    if let Ok(out) = std::process::Command::new("defaults").args(["read", "-g", "AppleLanguages"]).output() {
        let listed = String::from_utf8_lossy(&out.stdout);
        if let Some(first) = listed.split('"').nth(1) {
            return base(first).to_ascii_lowercase();
        }
    }
    "en".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    const CATALOGUE: &str = r#"{"product":"t","texts":{"a":{"en":"For {hours} hours","places":["hours"]},"b":{"en":"Deny"}}}"#;

    #[test]
    fn a_language_reads_its_words_and_falls_back_to_english() {
        let texts = Texts::embedded(CATALOGUE, &[("pl", r#"{"a":"Na {hours} godz."}"#)]).unwrap();
        assert_eq!(texts.say("pl_PL.UTF-8", "a", &[("hours", "3")]), "Na 3 godz.");
        assert_eq!(texts.say("pl", "b", &[]), "Deny");
        assert_eq!(texts.say("xx", "a", &[("hours", "2")]), "For 2 hours");
        assert_eq!(texts.say("pl", "unknown", &[]), "unknown");
    }

    #[test]
    fn a_key_without_english_is_refused() {
        let refused = Texts::embedded(r#"{"texts":{"a":{"for":"x"}}}"#, &[]).err().unwrap();
        assert!(refused.0.contains("key a has no en text"));
    }
}
