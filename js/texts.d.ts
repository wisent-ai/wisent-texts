/** A product's texts/bundle.json, written by `texts bundle`. */
export type Bundle = {
  product: string;
  source: string;
  texts: Record<string, string>;
  translations: Record<string, Record<string, string>>;
};

export type Texts = {
  /** The text of `key` in `language` (`pl`, `pl-PL`), English when the language lacks it. */
  say(language: string, key: string, values?: Record<string, string | number>): string;
};

export function texts(bundle: Bundle): Texts;
