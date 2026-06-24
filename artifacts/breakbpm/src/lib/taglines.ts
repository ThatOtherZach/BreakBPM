export const TAGLINES: string[] = [
  'PLAY FAST,\nRACK STATS',
  'SHARK YOURSELF',
  'IN THE KITCHEN',
  'STRIPES OR SOLIDS?',
  'STATS ON RACKS!',
  'NICE RACK!',
  'BANK AND\nRANK IT',
  'THE ULTIMATE POOL TOOL',
  'MEASURE EVERY SHOT\nOR HIT UNDO ;)',
  'TURN EACH RACK\nINTO STATS',
];

export function pickTagline(): string {
  return TAGLINES[Math.floor(Math.random() * TAGLINES.length)];
}
