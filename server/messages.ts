import type { Entry } from "../shared/types.js";

/** Repair only the old stream/final index mismatch within one provider message. */
export function mergeLegacyAssistantDuplicates(entries: Entry[]): Entry[] {
  const seen = new Map<string, { index: number; text: string }[]>();
  return entries.filter((entry) => {
    const match =
      entry.kind === "assistant" && /^(msg_[^:]+):(\d+)$/.exec(entry.id);
    if (!match) return true;
    const index = Number(match[2]);
    const prior = seen.get(match[1]) || [];
    if (prior.some((item) => item.index > index && item.text === entry.text))
      return false;
    prior.push({ index, text: entry.text });
    seen.set(match[1], prior);
    return true;
  });
}
