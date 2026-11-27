const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function agencyAliases(name: string): Set<string> {
  const bracketed = [...name.matchAll(/\(([^)]+)\)/g)].map((match) => match[1]);
  const withoutBrackets = name.replace(/\([^)]*\)/g, " ");
  const parts = [name, withoutBrackets, ...bracketed, ...withoutBrackets.split("/")];
  return new Set(parts.map(normalise).filter(Boolean));
}

export function belongsToAgency(recorded: string, aliases: ReadonlySet<string>): boolean {
  return recorded
    .split(/[,;/&]| and /i)
    .concat(recorded)
    .some((part) => aliases.has(normalise(part)));
}
