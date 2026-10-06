/**
 * Material for a synopsis prompt: fenced, and quoted line by line
 * (f-journey-record t-146, t-147).
 *
 * Both of the seat's prompts (`prompt.ts`, `reread.ts`) put the person's words
 * between fences and tell the model what is inside is material, not
 * instructions. That holds only while nothing inside can close a fence or pose
 * as a label, so every fence the prompt draws is stripped from the material
 * and every line of it is quoted with "> ". One helper, so a fix to the
 * defence reaches both prompts.
 */

/**
 * The text with every one of `fences` stripped and every line quoted, so
 * nothing in it can close a fence or pass for an unquoted label.
 */
export function quoteMaterial(text: string, fences: readonly string[]): string {
  let clean = text;
  for (const fence of fences) clean = clean.replaceAll(fence, '');
  return clean
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}
