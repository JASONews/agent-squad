import { AppError } from '@agent-squad/core';

export interface ClaudeEnglishInputPolicy {
  enabled: boolean;
  minimumRatio: number;
}

export const DEFAULT_CLAUDE_ENGLISH_INPUT_POLICY: ClaudeEnglishInputPolicy = {
  enabled: true,
  minimumRatio: 0.6,
};

export interface ClaudeInputLanguage {
  englishWords: number;
  otherWords: number;
  ratio: number;
}

const WORD_UNIT = /\p{Script=Latin}+(?:['’]\p{Script=Latin}+)*|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|\p{L}+/gu;
const LATIN_WORD = /^\p{Script=Latin}+(?:['’]\p{Script=Latin}+)*$/u;

function proseOnly(message: string): string {
  return message
    .replace(/(```|~~~)[\s\S]*?\1/g, ' ')
    .replace(/`[^`\r\n]*`/g, ' ')
    .replace(/\b(?:https?|file):\/\/\S+/gi, ' ')
    .replace(/(?:^|\s)(?:\/|\.{1,2}\/)\S+/gm, ' ')
    .replace(/\b[A-Za-z]:\\\S+/g, ' ');
}

export function analyzeClaudeInputLanguage(message: string): ClaudeInputLanguage {
  let englishWords = 0;
  let otherWords = 0;
  for (const match of proseOnly(message).matchAll(WORD_UNIT)) {
    if (LATIN_WORD.test(match[0])) englishWords += 1;
    else otherWords += 1;
  }
  const total = englishWords + otherWords;
  return {
    englishWords,
    otherWords,
    ratio: total === 0 ? 0 : englishWords / total,
  };
}

export function assertClaudeInputPrimarilyEnglish(message: string, minimumRatio: number): void {
  if (minimumRatio === 0) return;
  const analysis = analyzeClaudeInputLanguage(message);
  if (analysis.englishWords > 0 && analysis.ratio >= minimumRatio) return;
  const detected = Math.round(analysis.ratio * 100);
  const required = Math.round(minimumRatio * 100);
  throw new AppError(
    'claude_input_requires_english',
    `Claude subagent input must be primarily English (at least ${required}% English words; detected ${detected}%). Rewrite or translate the task into English before retrying.`,
  );
}
