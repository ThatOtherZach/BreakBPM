import { randomBytes } from "crypto";

/** Random 16-byte hex (32 chars) — used as the internal user id, pass id, etc. */
export function newId(): string {
  return randomBytes(16).toString("hex");
}
