export function deriveRemainingSeconds({ now, eventEndsAt, penaltiesSeconds }) {
  const base = Math.floor((new Date(eventEndsAt).getTime() - now.getTime()) / 1000);
  return Math.max(0, base - penaltiesSeconds);
}

export function normalizeAnswer(value) {
  return `${value || ""}`
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}
