export const TAGLINES: string[] = [
  'PLAY FAST,\nTRACK STATS',
  'SHARK YOURSELF',
];

export function pickTagline(): string {
  return TAGLINES[Math.floor(Math.random() * TAGLINES.length)];
}
