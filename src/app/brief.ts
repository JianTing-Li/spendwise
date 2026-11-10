/** Display-only excerpt. Never paraphrase, reclassify, or replace the saved finding. */
export function excerpt(text: string, limit: number) {
  const words = text.trim().split(/\s+/);
  if (words.length <= limit) return { text, shortened: false };
  return { text: `${words.slice(0, limit).join(" ")}…`, shortened: true };
}
