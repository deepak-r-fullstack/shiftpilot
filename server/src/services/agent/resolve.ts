// Turns what the coordinator typed ("Priya", "Mr. Rao", "CG-07") into one record,
// or into a clear question: two people match, or nobody does (with near misses).

export interface Named {
  code: string;
  name: string;
}

export type Resolved<T extends Named> =
  | { kind: "found"; item: T }
  | { kind: "ambiguous"; query: string; choices: Named[] }
  | { kind: "notFound"; query: string; suggestions: Named[] };

const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "mx"]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !TITLES.has(token));
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

const brief = (item: Named): Named => ({ code: item.code, name: item.name });

export function resolveByName<T extends Named>(list: T[], query: string): Resolved<T> {
  const trimmed = query.trim();
  const byCode = list.find((item) => item.code.toLowerCase() === trimmed.toLowerCase());
  if (byCode) return { kind: "found", item: byCode };

  const wanted = tokens(trimmed);
  if (wanted.length === 0) return { kind: "notFound", query, suggestions: [] };
  const exact = list.filter((item) => tokens(item.name).join(" ") === wanted.join(" "));
  if (exact.length === 1) return { kind: "found", item: exact[0] };

  const matches = list.filter((item) => {
    const nameTokens = tokens(item.name);
    return wanted.every((token) => nameTokens.includes(token));
  });
  if (matches.length === 1) return { kind: "found", item: matches[0] };
  if (matches.length > 1) return { kind: "ambiguous", query, choices: matches.map(brief) };

  const suggestions = list.filter((item) =>
    wanted.some((token) => token.length >= 3 && tokens(item.name).some((nameToken) => editDistance(token, nameToken) <= 2))
  );
  return { kind: "notFound", query, suggestions: suggestions.slice(0, 3).map(brief) };
}
