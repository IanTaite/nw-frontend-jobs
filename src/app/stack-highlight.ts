/** One piece of a job-card stack string: plain text, or a highlighted framework name. */
export interface StackSegment {
  text: string;
  /** Present when `text` is a framework name to highlight. */
  framework?: 'angular' | 'react' | 'vue';
}

const FRAMEWORK_RE = /(?<![A-Za-z])(Angular|React|Vue)(?=js|\b)/gi;

const FRAMEWORK_CLASS: Record<NonNullable<StackSegment['framework']>, string> = {
  angular: 'rounded px-1 font-semibold bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-200',
  react: 'rounded px-1 font-semibold bg-sky-200 text-sky-950 dark:bg-sky-950 dark:text-sky-200',
  vue: 'rounded px-1 font-semibold bg-emerald-200 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
};

/** Tailwind classes for a highlighted framework segment (light + dark). */
export function frameworkClass(framework: NonNullable<StackSegment['framework']>): string {
  return FRAMEWORK_CLASS[framework];
}

/**
 * Split a stack string so Angular / React / Vue stand out in the card.
 * Matches case-insensitively at a word start. A following "js" (AngularJS) or a word
 * boundary (React Native, Vue.js, Next.js/React) keeps the framework part highlighted
 * without matching words like "reactive". Original casing is preserved.
 * Returns plain text segments for safe rendering — never use with innerHTML.
 */
export function highlightStack(stack: string): StackSegment[] {
  if (!stack) return [];
  const segments: StackSegment[] = [];
  let last = 0;
  for (const match of stack.matchAll(FRAMEWORK_RE)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: stack.slice(last, start) });
    const text = match[0];
    const framework = text.toLowerCase() as NonNullable<StackSegment['framework']>;
    segments.push({ text, framework });
    last = start + text.length;
  }
  if (last < stack.length) segments.push({ text: stack.slice(last) });
  return segments.length ? segments : [{ text: stack }];
}
