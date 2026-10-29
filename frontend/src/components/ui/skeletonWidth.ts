/** Widths that vary from row to row like real text (full class names, so Tailwind keeps them). */
const WIDTHS = ["w-3/4", "w-1/2", "w-2/3", "w-5/6", "w-3/5", "w-4/5"] as const;
/** The same idea in fixed sizes, for lines in wide rows where a fraction would hit the same cap every time. */
const LINES = ["w-72", "w-52", "w-80", "w-60", "w-44", "w-64"] as const;

export const widthAt = (i: number) => WIDTHS[i % WIDTHS.length];
export const lineAt = (i: number) => `${LINES[i % LINES.length]} max-w-full`;
