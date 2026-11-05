//! A product's words in the language its reader reads.
//!
//! A product embeds its `texts/bundle.json` (written by `texts bundle`) with
//! `include_str!` and asks [`Texts::say`] for a key in a language. A language
//! that lacks the key, or that the fleet does not speak, reads English; a key
//! the bundle does not hold is the product's defect and answers the key
//! itself, so a missing word is visible instead of blank. `texts check`
//! refuses both before a product ships.

use std::collections::HashMap;

/// A product's English texts and every translation of them.
pub struct Texts {
    source: HashMap<String, String>,
    translations: HashMap<String, HashMap<String, String>>,
}

#[derive(serde::Deserialize)]
struct Bundle {
    texts: HashMap<String, String>,
    #[serde(default)]
    translations: HashMap<String, HashMap<String, String>>,
}

/// Why a bundle could not be read.
#[derive(Debug)]
pub struct Unreadable(pub String);

impl std::fmt::Display for Unreadable {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for Unreadable {}

impl Texts {
    /// The bundle JSON, as `include_str!("../texts/bundle.json")` embeds it.
    pub fn bundle(json: &str) -> Result<Self, Unreadable> {
        let bundle: Bundle = serde_json::from_str(json).map_err(|error| {
            Unreadable(format!("the texts bundle is not texts and translations of strings: {error}; write it with texts bundle"))
        })?;
        Ok(Self { source: bundle.texts, translations: bundle.translations })
    }

    /// Every text of `key`, English and each translation: what recognises a
    /// product's own words after the reader's language changed.
    pub fn every<'a>(&'a self, key: &'a str) -> impl Iterator<Item = &'a str> + 'a {
        self.source
            .get(key)
            .into_iter()
            .chain(self.translations.values().filter_map(move |words| words.get(key)))
            .map(String::as_str)
    }

    /// The text of `key` in `language`, with each `{name}` replaced by its value.
    pub fn say(&self, language: &str, key: &str, values: &[(&str, &str)]) -> String {
        let text = self
            .translations
            .get(base(language).as_str())
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

/// `pl-PL`, `pl_PL.UTF-8` and `PL` all read `pl`.
fn base(language: &str) -> String {
    language.split(['-', '_', '.']).next().unwrap_or(language).to_ascii_lowercase()
}

/// The language the person at this machine reads: `LC_ALL`, `LC_MESSAGES`,
/// `LANG`, then on macOS the first of `AppleLanguages`; English otherwise.
pub fn language() -> String {
    for name in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(value) = std::env::var(name) {
            let code = base(&value);
            if !code.is_empty() && code != "c" && code != "posix" {
                return code;
            }
        }
    }
    #[cfg(target_os = "macos")]
    if let Ok(out) = std::process::Command::new("defaults").args(["read", "-g", "AppleLanguages"]).output() {
        let listed = String::from_utf8_lossy(&out.stdout);
        if let Some(first) = listed.split('"').nth(1) {
            return base(first);
        }
    }
    "en".into()
}

/// One language the fleet speaks: its code, English name and native name.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct Language {
    pub code: String,
    pub english: String,
    pub native: String,
}

#[derive(serde::Deserialize)]
struct Fleet {
    languages: Vec<Language>,
}

/// Every language the fleet speaks (`languages.json`), the one list a product
/// offers its reader instead of keeping its own.
pub fn languages() -> &'static [Language] {
    static FLEET: std::sync::LazyLock<Vec<Language>> = std::sync::LazyLock::new(|| {
        let fleet: Fleet = serde_json::from_str(include_str!("../../languages.json"))
            .expect("languages.json at the crate's repository root is the fleet's language list");
        fleet.languages
    });
    &FLEET
}

#[cfg(test)]
mod tests {
    use super::*;

    const BUNDLE: &str = r#"{"product":"t","source":"en","texts":{"a":"For {hours} hours","b":"Deny"},"translations":{"pl":{"a":"Na {hours} godz."}}}"#;

    #[test]
    fn a_language_reads_its_words_and_falls_back_to_english() {
        let texts = Texts::bundle(BUNDLE).unwrap();
        assert_eq!(texts.say("pl_PL.UTF-8", "a", &[("hours", "3")]), "Na 3 godz.");
        assert_eq!(texts.say("pl", "b", &[]), "Deny");
        assert_eq!(texts.say("xx", "a", &[("hours", "2")]), "For 2 hours");
        assert_eq!(texts.say("pl", "unknown", &[]), "unknown");
        let mut every: Vec<&str> = texts.every("a").collect();
        every.sort_unstable();
        assert_eq!(every, ["For {hours} hours", "Na {hours} godz."]);
    }

    #[test]
    fn the_fleet_list_holds_english_and_every_language_once() {
        let codes: Vec<&str> = languages().iter().map(|language| language.code.as_str()).collect();
        assert!(codes.contains(&"en") && codes.contains(&"pl") && codes.contains(&"zh"));
        let mut unique = codes.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), codes.len());
    }

    #[test]
    fn a_bundle_without_texts_is_refused() {
        let refused = Texts::bundle(r#"{"translations":{}}"#).err().unwrap();
        assert!(refused.0.contains("write it with texts bundle"));
    }
}
