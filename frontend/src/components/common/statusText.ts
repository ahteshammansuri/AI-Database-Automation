/** "PENDING_APPROVAL" -> "Pending approval" */
export const humanStatus = (s: string): string => {
  const t = s.replace(/[_-]+/g, " ").trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
