import Foundation

/// A product's words in the language its reader reads; the same contract as
/// the Rust crate and the JS module. `bundle` is the product's
/// `texts/bundle.json`, written by `texts bundle`.
public struct Texts: Sendable {
    private let source: [String: String]
    private let translations: [String: [String: String]]

    public struct Unreadable: Error, CustomStringConvertible {
        public let description: String
    }

    private struct Bundle: Decodable {
        let texts: [String: String]
        let translations: [String: [String: String]]?
    }

    public init(bundle data: Data) throws {
        do {
            let bundle = try JSONDecoder().decode(Bundle.self, from: data)
            source = bundle.texts
            translations = bundle.translations ?? [:]
        } catch {
            throw Unreadable(description: "the texts bundle is not texts and translations of strings: \(error); write it with texts bundle")
        }
    }

    /// The text of `key` in `language` (`pl`, `pl-PL`, `pl_PL.UTF-8`) with each
    /// `{name}` replaced; English when the language lacks it, the key itself
    /// when the bundle does not hold it.
    public func say(_ key: String, in language: String, _ values: [String: String] = [:]) -> String {
        var text = translations[Self.base(language)]?[key] ?? source[key] ?? key
        for (name, value) in values {
            text = text.replacingOccurrences(of: "{\(name)}", with: value)
        }
        return text
    }

    static func base(_ language: String) -> String {
        String(language.split(whereSeparator: { "-_.".contains($0) }).first ?? Substring(language)).lowercased()
    }
}
