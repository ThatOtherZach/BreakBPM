// Export helpers for the shareable <StreamWidget> image. The widget is rendered
// to the DOM (offscreen) and snapshotted to a PNG with html-to-image, so the
// share image is pixel-identical to the on-screen / OBS widget (ONE widget, two
// surfaces). Mirrors redeemCard.ts's font-preload + download approach.
import { toBlob } from "html-to-image";

/**
 * Best-effort: ensure the widget's fonts are loaded before snapshotting so the
 * hero numerals render in VT323 rather than a fallback. Degrades silently.
 */
export async function ensureWidgetFonts(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  try {
    await Promise.all([
      document.fonts.load('92px "VT323"', "0123456789.%"),
      document.fonts.load('13px "Tahoma"', "BREAKBPM"),
    ]);
  } catch {
    /* fall back to system fonts — snapshot still proceeds */
  }
}

/** Snapshot a DOM node to a PNG Blob (2x for a crisp share image). */
export async function nodeToPngBlob(node: HTMLElement): Promise<Blob | null> {
  await ensureWidgetFonts();
  return toBlob(node, {
    pixelRatio: 2,
    cacheBust: true,
    // Transparent padding around the Win98 window reads cleanly on any chat bg.
    style: { margin: "0" },
  });
}

/** Safe download filename for a handle's share image. */
export function shareImageFilename(handle: string | null): string {
  const safe = (handle ?? "game").replace(/[^A-Za-z0-9_-]/g, "");
  return `breakbpm-${safe || "game"}.png`;
}

/** Trigger a browser download of a PNG blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type ShareOutcome = "shared" | "downloaded" | "failed";

/**
 * Share a rendered widget node as an image. Prefers the native share sheet
 * (with the PNG file attached) when the browser supports sharing files; falls
 * back to a plain PNG download otherwise. Returns what actually happened so the
 * UI can show the right confirmation.
 */
export async function shareWidgetImage(opts: {
  node: HTMLElement;
  handle: string | null;
  url: string | null;
  title?: string;
  text?: string;
}): Promise<ShareOutcome> {
  const filename = shareImageFilename(opts.handle);
  let blob: Blob | null;
  try {
    blob = await nodeToPngBlob(opts.node);
  } catch {
    return "failed";
  }
  if (!blob) return "failed";

  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };
  const shareData: ShareData = {
    files: [file],
    title: opts.title ?? "BreakBPM",
    ...(opts.text ? { text: opts.text } : {}),
    ...(opts.url ? { url: opts.url } : {}),
  };
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share(shareData);
      return "shared";
    } catch (e) {
      // User cancelled the native sheet — don't fall through to a download.
      if (e instanceof DOMException && e.name === "AbortError") return "shared";
      // Any other failure: fall back to a download below.
    }
  }
  downloadBlob(blob, filename);
  return "downloaded";
}

/** Copy text (the watch link) to the clipboard; resolves to success boolean. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
