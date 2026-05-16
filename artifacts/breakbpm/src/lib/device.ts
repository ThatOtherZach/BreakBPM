/** Device id stored in localStorage — used as the second key for the public-free cooldown. */
const KEY = "breakbpm.deviceId";

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id || id.length < 8) {
      id = newDeviceId();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return newDeviceId();
  }
}

function newDeviceId(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}
