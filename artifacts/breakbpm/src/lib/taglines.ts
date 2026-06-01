export const TAGLINES: string[] = [
  'PLAY FAST,\nRACK STATS',
  'SHARK YOURSELF',
  'IN THE KITCHEN',
];

export function pickTagline(): string {
  return TAGLINES[Math.floor(Math.random() * TAGLINES.length)];
}
