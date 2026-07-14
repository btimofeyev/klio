import "server-only";

import dictionary from "dictionary-en";
import nspell from "nspell";

export type SpellingIssue = {
  word: string;
  suggestions: string[];
};

const checker = nspell({
  aff: Buffer.from(dictionary.aff),
  dic: Buffer.from(dictionary.dic),
});

[
  "Klio",
  "homeschool",
  "homeschooling",
  "curriculum",
  "curricula",
  "worksheet",
  "worksheets",
  "schoolwork",
  "replan",
  "reschedule",
  "Algebra",
].forEach((word) => checker.add(word));

const preferredCorrections: Record<string, string> = {
  mintues: "minutes",
  thrty: "thirty",
};

export function checkSpelling(words: string[]): SpellingIssue[] {
  const uniqueWords = [...new Map(words.map((word) => [word.toLocaleLowerCase("en-US"), word])).values()];

  return uniqueWords.flatMap((word) => {
    if (checker.correct(word)) return [];
    const preferred = preferredCorrections[word.toLocaleLowerCase("en-US")];
    const suggestions = [...new Set([preferred, ...checker.suggest(word)].filter((item): item is string => Boolean(item)))].slice(0, 5);
    return suggestions.length ? [{ word, suggestions }] : [];
  });
}
