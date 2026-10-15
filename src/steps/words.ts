/**
 * Instructions are stored as numbered steps ("1. …\n2. …"), but every word must come from
 * the source, in order (SPEC §3 rule 1). Only the source's own step labels may go:
 * "step 1" / "STEP 2 -" headers, "1." / "2)" at the start of a line, and bare line-start
 * numbers that count up from 1 or 2 ("1 Prepare the brisket", or "2" alone on a line after an
 * unnumbered first step).
 */

type Token = { text: string; removable: boolean };

const NUMBERED_LINE = /^(\d+)\. (\S.*)$/;

/** `steps` as stored: "1. …" per line, each step on one line. */
export function formatSteps(steps: string[]): string {
  return steps.map((step, i) => `${i + 1}. ${step}`).join("\n");
}

/** True when `text` is already numbered steps: every line "N. …", counting up from 1. */
export function isNumberedSteps(text: string): boolean {
  const lines = text.split("\n");
  return lines.every((line, i) => {
    const match = NUMBERED_LINE.exec(line);
    return match !== null && Number(match[1]) === i + 1 && line === line.trimEnd();
  });
}

/**
 * True when `stored` is `original` itself, or numbered steps that keep every word of
 * `original` in order, dropping nothing but the source's step labels.
 */
export function keepsEveryWord(original: string, stored: string): boolean {
  return wordProblem(original, stored) === null;
}

/** Why `stored` doesn't keep every word of `original` (see `keepsEveryWord`), or null. */
export function wordProblem(original: string, stored: string): string | null {
  if (stored === original) return null;
  if (!isNumberedSteps(stored)) return "not numbered steps";
  const kept = stored.split("\n").flatMap((line) => words(NUMBERED_LINE.exec(line)?.[2] ?? ""));
  const source = sourceTokens(original);

  let k = 0;
  for (const [i, token] of source.entries()) {
    if (k < kept.length && token.text === kept[k]) k++;
    else if (!token.removable) {
      const context = source.slice(Math.max(0, i - 3), i + 2).map((t) => t.text).join(" ");
      return `original word ${i + 1} "${token.text}" (in "${context}") is missing; the steps have "${kept[k] ?? "(end)"}" there`;
    }
  }
  return k === kept.length ? null : `the steps add "${kept.slice(k).join(" ")}" at the end`;
}

/** Soft hyphens and zero-width characters are invisible; they don't count as a change. */
const words = (text: string): string[] =>
  text
    .replace(/[\u00ad\u200b-\u200d\ufeff]/g, "")
    .split(/\s+/)
    .filter((w) => w !== "");

function sourceTokens(text: string): Token[] {
  const lines = text.split(/\r\n|\r|\n/).map(words);
  const tokens: Token[] = [];
  let nextBare = 1;
  const bare: Token[] = [];
  for (const line of lines) {
    line.forEach((text, i) => {
      const token = { text, removable: false };
      if (i === 0 && /^\d+[.)]$/.test(text)) token.removable = true;
      // Counting starts at 2 when the author left the first step unnumbered.
      if (i === 0 && /^\d+$/.test(text) && (Number(text) === nextBare || (bare.length === 0 && Number(text) === 2))) {
        bare.push(token);
        nextBare = Number(text) + 1;
      }
      tokens.push(token);
    });
    // "step 1", "STEP 2 -", "Step 3:" at the start of a line.
    if (line.length > 0 && /^step$/i.test(line[0] ?? "") && /^\d+[.):]?$/.test(line[1] ?? "")) {
      const at = tokens.length - line.length;
      for (const t of tokens.slice(at, at + 2)) t.removable = true;
      if (/^[-–:]$/.test(line[2] ?? "")) (tokens[at + 2] as Token).removable = true;
    }
  }
  // A lone "1" or "2" is more likely an amount ("1 tomato, peeled") than a step number.
  if (bare.length >= 2) for (const t of bare) t.removable = true;
  return tokens;
}
