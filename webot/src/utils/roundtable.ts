type RoundtableRoleSource = "onstage" | "backstage";

interface RoundtableRole {
  name: string;
  trait: string;
}

export function getRoundtableRoleKey(
  source: RoundtableRoleSource,
  index: number,
  role: RoundtableRole,
): string {
  return `${source}:${index}:${role.name}:${role.trait}`;
}
