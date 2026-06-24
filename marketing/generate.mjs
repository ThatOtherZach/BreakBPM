// BreakBPM — Instagram marketing graphics generator ("Shareware Drop" concept).
// Renders exact-size PNGs (1080x1080 squares + 1080x1920 stories) in the app's
// retro Win98 + CRT phosphor brand. Run: `node marketing/generate.mjs`
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "instagram");
const FONTS = join(HERE, "fonts");
const PUB = join(HERE, "..", "artifacts", "breakbpm", "public");
mkdirSync(OUT, { recursive: true });

// ── Fonts ──────────────────────────────────────────────────────────────────
GlobalFonts.registerFromPath(join(FONTS, "VT323-Regular.ttf"), "VT323");
GlobalFonts.registerFromPath(join(FONTS, "PressStart2P-Regular.ttf"), "PS2P");
GlobalFonts.registerFromPath("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "Dejavu");
GlobalFonts.registerFromPath("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "DejavuB");

// ── Brand tokens ─────────────────────────────────────────────────────────────
const C = {
  green: "#00ff41", greenDim: "#10c233", amber: "#ffb300",
  navy: "#000080", blue: "#1084d0", teal: "#008080",
  silver: "#c0c0c0", silverHi: "#dfdfdf", gray: "#808080",
  black: "#000000", white: "#ffffff", crt: "#050a06",
  felt: "#0f5a2e", feltLit: "#147a3e", wood: "#7a4a22", red: "#c8161d",
};

// ── Low-level helpers ────────────────────────────────────────────────────────
function bevel(ctx, x, y, w, h, raised = true) {
  const a = raised ? C.white : C.gray;
  const a2 = raised ? C.silverHi : C.black;
  const b = raised ? C.black : C.white;
  const b2 = raised ? C.gray : C.silverHi;
  ctx.fillStyle = a; ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y, 2, h);
  ctx.fillStyle = b; ctx.fillRect(x, y + h - 2, w, 2); ctx.fillRect(x + w - 2, y, 2, h);
  ctx.fillStyle = a2; ctx.fillRect(x + 2, y + 2, w - 4, 2); ctx.fillRect(x + 2, y + 2, 2, h - 4);
  ctx.fillStyle = b2; ctx.fillRect(x + 2, y + h - 4, w - 4, 2); ctx.fillRect(x + w - 4, y + 2, 2, h - 4);
}

function tri(ctx, cx, cy, s, color) {
  ctx.save(); ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(cx - s / 2, cy - s); ctx.lineTo(cx - s / 2, cy + s); ctx.lineTo(cx + s, cy);
  ctx.closePath(); ctx.fill(); ctx.restore();
}

function setFont(ctx, fam, size) { ctx.font = `${size}px "${fam}"`; }

// text with optional letter tracking, faux-bold, glow
function txt(ctx, s, x, y, o = {}) {
  const { fam = "VT323", size = 80, color = C.green, align = "left",
    baseline = "alphabetic", glow = 0, bold = false, track = 0 } = o;
  ctx.save();
  setFont(ctx, fam, size);
  ctx.textBaseline = baseline;
  ctx.fillStyle = color;
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  const boff = Math.max(0.8, size * 0.014);
  if (track) {
    let total = 0;
    for (const ch of s) total += ctx.measureText(ch).width + track;
    total -= track;
    let sx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
    ctx.textAlign = "left";
    for (const ch of s) {
      ctx.fillText(ch, sx, y);
      if (bold) ctx.fillText(ch, sx + boff, y);
      sx += ctx.measureText(ch).width + track;
    }
  } else {
    ctx.textAlign = align;
    ctx.fillText(s, x, y);
    if (bold) ctx.fillText(s, x + boff, y);
  }
  ctx.restore();
}

function measure(ctx, s, fam, size) { setFont(ctx, fam, size); return ctx.measureText(s).width; }

function wrap(ctx, s, maxW, fam, size) {
  setFont(ctx, fam, size);
  const words = s.split(" "); const lines = []; let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width <= maxW) cur = t;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function scanlines(ctx, x, y, w, h, gap = 4, alpha = 0.17) {
  ctx.save(); ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  for (let yy = y; yy < y + h; yy += gap) ctx.fillRect(x, yy, w, 1);
  ctx.restore();
}

function vignette(ctx, x, y, w, h) {
  const g = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.18,
    x + w / 2, y + h / 2, Math.max(w, h) * 0.62);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.save(); ctx.fillStyle = g; ctx.fillRect(x, y, w, h); ctx.restore();
}

function drawImageCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

// vector 8-ball
function eightBall(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  g.addColorStop(0, "#5a5a5a"); g.addColorStop(0.45, "#171717"); g.addColorStop(1, "#000");
  ctx.save();
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  // white number patch
  ctx.fillStyle = C.white; ctx.beginPath(); ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2); ctx.fill();
  txt(ctx, "8", cx, cy + r * 0.30, { fam: "DejavuB", size: r * 0.62, color: C.black, align: "center" });
  // specular
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath(); ctx.ellipse(cx - r * 0.4, cy - r * 0.45, r * 0.18, r * 0.1, -0.7, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ── Window chrome ────────────────────────────────────────────────────────────
function windowFrame(ctx, W, H, title) {
  const M = 22;
  // teal desktop
  ctx.fillStyle = C.teal; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,0.06)";
  for (let yy = 0; yy < H; yy += 4) ctx.fillRect(0, yy, W, 1);
  // panel
  const px = M, py = M, pw = W - M * 2, ph = H - M * 2;
  ctx.fillStyle = C.silver; ctx.fillRect(px, py, pw, ph);
  bevel(ctx, px, py, pw, ph, true);
  // title bar
  const tbH = 66, tbx = px + 6, tby = py + 6, tbw = pw - 12;
  const tg = ctx.createLinearGradient(tbx, 0, tbx + tbw, 0);
  tg.addColorStop(0, C.navy); tg.addColorStop(1, C.blue);
  ctx.fillStyle = tg; ctx.fillRect(tbx, tby, tbw, tbH);
  // titlebar 8-ball + text
  eightBall(ctx, tbx + 32, tby + tbH / 2, 19);
  txt(ctx, title, tbx + 62, tby + tbH / 2 + 9, { fam: "DejavuB", size: 27, color: C.white, align: "left" });
  // window buttons
  const btn = 42, bgap = 6, byy = tby + (tbH - btn) / 2;
  let bxx = tbx + tbw - 8 - btn;
  const drawBtn = (glyph) => {
    ctx.fillStyle = C.silver; ctx.fillRect(bxx, byy, btn, btn); bevel(ctx, bxx, byy, btn, btn, true);
    glyph(bxx, byy); bxx -= btn + bgap;
  };
  // close (X)
  drawBtn((x, y) => txt(ctx, "X", x + btn / 2, y + btn / 2 + 8, { fam: "DejavuB", size: 22, color: C.black, align: "center" }));
  // maximize
  drawBtn((x, y) => { ctx.strokeStyle = C.black; ctx.lineWidth = 2; ctx.strokeRect(x + 11, y + 11, btn - 22, btn - 22); ctx.fillStyle = C.black; ctx.fillRect(x + 11, y + 11, btn - 22, 4); });
  // minimize
  drawBtn((x, y) => { ctx.fillStyle = C.black; ctx.fillRect(x + 11, y + btn - 16, btn - 22, 4); });
  // content area (sunken)
  const cx = px + 6, cy = tby + tbH + 6, cw = pw - 12, ch = ph - (tbH + 18);
  bevel(ctx, cx, cy, cw, ch, false);
  const r = { x: cx + 4, y: cy + 4, w: cw - 8, h: ch - 8 };
  return r;
}

function crtFill(ctx, r) { ctx.fillStyle = C.crt; ctx.fillRect(r.x, r.y, r.w, r.h); }
function crtFinish(ctx, r) {
  scanlines(ctx, r.x, r.y, r.w, r.h);
  vignette(ctx, r.x, r.y, r.w, r.h);
  ctx.save(); ctx.strokeStyle = "rgba(0,255,65,0.35)"; ctx.lineWidth = 3;
  ctx.shadowColor = C.green; ctx.shadowBlur = 16;
  ctx.strokeRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8); ctx.restore();
}

// CTA strip at bottom of a CRT screen (auto-fits label width)
function ctaStrip(ctx, r, label = "PLAY FREE  —  BREAKBPM.COM") {
  const h = Math.round(r.h * 0.092), y = r.y + r.h - h;
  ctx.fillStyle = C.navy; ctx.fillRect(r.x, y, r.w, h);
  ctx.fillStyle = C.amber; ctx.fillRect(r.x, y, r.w, 3);
  const triS = h * 0.16, leftPad = 44 + triS + 22, budget = r.w - leftPad - 40;
  let size = h * 0.30;
  setFont(ctx, "PS2P", size);
  const w = ctx.measureText(label).width;
  if (w > budget) size = size * budget / w;
  tri(ctx, r.x + 44, y + h / 2, triS, C.green);
  txt(ctx, label, r.x + leftPad, y + h / 2 + size * 0.36, { fam: "PS2P", size, color: C.green, align: "left", glow: 10 });
}

// small amber publisher tag
function publisher(ctx, x, y, size = 18) {
  txt(ctx, "SAYM SOFTWARE SYSTEMS", x, y, { fam: "PS2P", size, color: C.amber, align: "left", track: 2 });
}

// ── Asset renderers ──────────────────────────────────────────────────────────
const assets = {};

assets["01-hero-square"] = async (ctx, W, H) => {
  const r = windowFrame(ctx, W, H, "BreakBPM.exe");
  crtFill(ctx, r);
  publisher(ctx, r.x + 40, r.y + 56, 18);
  txt(ctx, "EST. 1999", r.x + r.w - 40, r.y + 58, { fam: "VT323", size: 30, color: C.greenDim, align: "right" });
  // headline
  txt(ctx, "NICE RACK,", r.x + 40, r.y + 250, { fam: "VT323", size: 150, color: C.green, align: "left", bold: true, glow: 18 });
  txt(ctx, "TRACK IT.", r.x + 40, r.y + 372, { fam: "VT323", size: 150, color: C.amber, align: "left", bold: true, glow: 18 });
  // 8-ball
  const img = await loadImage(join(PUB, "eightball_nobg.png")).catch(() => null);
  const bx = r.x + r.w - 250, by = r.y + 560, br = 175;
  if (img) ctx.drawImage(img, bx - br, by - br, br * 2, br * 2); else eightBall(ctx, bx, by, br);
  // lore block
  const lore = wrap(ctx, "Built by Saym Software Systems in the late '90s. Held back by the Y2K bug. Unreleased — until now.", r.w * 0.58, "VT323", 42);
  let ly = r.y + 540;
  for (const line of lore) { txt(ctx, line, r.x + 44, ly, { fam: "VT323", size: 42, color: C.green, align: "left" }); ly += 46; }
  ly += 24;
  txt(ctx, "The pool tracker that logs every shot —", r.x + 44, ly, { fam: "VT323", size: 40, color: C.amber }); ly += 44;
  txt(ctx, "accuracy % + Balls Per Minute, live.", r.x + 44, ly, { fam: "VT323", size: 40, color: C.amber });
  ctaStrip(ctx, r);
  crtFinish(ctx, r);
};

assets["02-what-square"] = async (ctx, W, H) => {
  const r = windowFrame(ctx, W, H, "stats.exe");
  crtFill(ctx, r);
  publisher(ctx, r.x + 40, r.y + 56, 18);
  txt(ctx, "EVERY SHOT,", r.x + r.w / 2, r.y + 190, { fam: "VT323", size: 130, color: C.green, align: "center", bold: true, glow: 16 });
  txt(ctx, "MEASURED.", r.x + r.w / 2, r.y + 300, { fam: "VT323", size: 130, color: C.amber, align: "center", bold: true, glow: 16 });
  txt(ctx, "Log every shot. Get the two numbers that matter:", r.x + r.w / 2, r.y + 372, { fam: "VT323", size: 40, color: C.green, align: "center" });
  // two readout panels
  const pad = 44, gap = 36, pw = (r.w - pad * 2 - gap) / 2, ph = 300, py = r.y + 420;
  const panel = (x, big, label, color) => {
    ctx.fillStyle = "rgba(0,255,65,0.05)"; ctx.fillRect(x, py, pw, ph);
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 12;
    ctx.strokeRect(x, py, pw, ph); ctx.restore();
    txt(ctx, big, x + pw / 2, py + ph * 0.56, { fam: "VT323", size: 150, color, align: "center", bold: true, glow: 14 });
    txt(ctx, label, x + pw / 2, py + ph - 36, { fam: "PS2P", size: 22, color: C.green, align: "center", track: 1 });
  };
  panel(r.x + pad, "87%", "ACCURACY", C.green);
  panel(r.x + pad + pw + gap, "4.2", "BALLS / MIN", C.amber);
  txt(ctx, "8-Ball  ·  9-Ball  ·  Practice  ·  Solo vs. Shark AI", r.x + r.w / 2, py + ph + 70, { fam: "VT323", size: 38, color: C.green, align: "center" });
  ctaStrip(ctx, r, "TRACK YOURS  —  BREAKBPM.COM");
  crtFinish(ctx, r);
};

assets["03-shark-square"] = async (ctx, W, H) => {
  const r = windowFrame(ctx, W, H, "shark.exe");
  crtFill(ctx, r);
  const img = await loadImage(join(PUB, "shark.jpg")).catch(() => null);
  if (img) {
    drawImageCover(ctx, img, r.x, r.y, r.w, r.h * 0.66);
    // green duotone wash + darken
    ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = "rgba(0,80,30,0.55)";
    ctx.fillRect(r.x, r.y, r.w, r.h * 0.66); ctx.restore();
    const grad = ctx.createLinearGradient(0, r.y, 0, r.y + r.h * 0.66);
    grad.addColorStop(0, "rgba(5,10,6,0.2)"); grad.addColorStop(1, "rgba(5,10,6,0.95)");
    ctx.fillStyle = grad; ctx.fillRect(r.x, r.y, r.w, r.h * 0.66);
  }
  publisher(ctx, r.x + 40, r.y + 56, 18);
  txt(ctx, "FACE THE", r.x + 40, r.y + r.h * 0.52, { fam: "VT323", size: 110, color: C.green, align: "left", bold: true, glow: 16 });
  txt(ctx, "SHARK", r.x + 40, r.y + r.h * 0.52 + 100, { fam: "VT323", size: 140, color: C.amber, align: "left", bold: true, glow: 18 });
  let ly = r.y + r.h * 0.72;
  const body = wrap(ctx, "Solo 8-ball against an invisible hustler AI. Miss a shot and it steals the table. Two difficulties. No mercy.", r.w - 88, "VT323", 44);
  for (const line of body) { txt(ctx, line, r.x + 44, ly, { fam: "VT323", size: 44, color: C.green }); ly += 48; }
  ctaStrip(ctx, r, "RACK 'EM  —  BREAKBPM.COM");
  crtFinish(ctx, r);
};

assets["04-leaderboard-square"] = async (ctx, W, H) => {
  const r = windowFrame(ctx, W, H, "leaderboard.exe");
  crtFill(ctx, r);
  publisher(ctx, r.x + 40, r.y + 56, 18);
  txt(ctx, "CLIMB THE BOARD", r.x + r.w / 2, r.y + 170, { fam: "VT323", size: 96, color: C.green, align: "center", bold: true, glow: 16 });
  txt(ctx, "Global + verified-hall rankings", r.x + r.w / 2, r.y + 222, { fam: "VT323", size: 40, color: C.amber, align: "center" });
  // table
  const rows = [
    ["1", "FAST_EDDIE", "6.1"], ["2", "MINNESOTA_M", "5.4"],
    ["3", "THE_HUSTLER", "4.9"], ["4", "YOU?", "4.2"], ["5", "BANK_SHOT_BO", "3.7"],
  ];
  const tx = r.x + 60, tw = r.w - 120; let ty = r.y + 320; const rh = 96;
  txt(ctx, "#", tx + 10, ty - 18, { fam: "PS2P", size: 20, color: C.greenDim });
  txt(ctx, "PLAYER", tx + 110, ty - 18, { fam: "PS2P", size: 20, color: C.greenDim });
  txt(ctx, "BPM", tx + tw - 20, ty - 18, { fam: "PS2P", size: 20, color: C.greenDim, align: "right" });
  for (const [rank, name, bpm] of rows) {
    const hi = name === "YOU?";
    ctx.fillStyle = hi ? "rgba(255,179,0,0.12)" : "rgba(0,255,65,0.05)";
    ctx.fillRect(tx, ty, tw, rh - 14);
    ctx.strokeStyle = hi ? C.amber : "rgba(0,255,65,0.25)"; ctx.lineWidth = hi ? 3 : 1.5;
    ctx.strokeRect(tx, ty, tw, rh - 14);
    const col = hi ? C.amber : C.green;
    txt(ctx, rank, tx + 22, ty + 56, { fam: "VT323", size: 56, color: col, bold: hi });
    txt(ctx, name, tx + 110, ty + 56, { fam: "VT323", size: 56, color: col, bold: hi });
    txt(ctx, bpm, tx + tw - 20, ty + 56, { fam: "VT323", size: 56, color: col, align: "right", bold: hi });
    ty += rh;
  }
  txt(ctx, "You're ranked after just 2 games.", r.x + r.w / 2, ty + 44, { fam: "VT323", size: 42, color: C.amber, align: "center" });
  ctaStrip(ctx, r, "GET ON IT  —  BREAKBPM.COM");
  crtFinish(ctx, r);
};

assets["05-free-square"] = async (ctx, W, H) => {
  const r = windowFrame(ctx, W, H, "setup.exe");
  // silver dialog (not CRT) for variety
  ctx.fillStyle = C.silver; ctx.fillRect(r.x, r.y, r.w, r.h);
  bevel(ctx, r.x + 4, r.y + 4, r.w - 8, r.h - 8, true);
  txt(ctx, "SAYM SOFTWARE SYSTEMS (C) 1999", r.x + 48, r.y + 64, { fam: "PS2P", size: 16, color: C.navy, track: 2 });
  txt(ctx, "BreakBPM Setup", r.x + 44, r.y + 150, { fam: "VT323", size: 92, color: C.navy, bold: true });
  // checklist
  const items = ["Free to play", "Nothing to install", "Runs in any browser", "No account needed to start"];
  let iy = r.y + 240;
  for (const it of items) {
    ctx.fillStyle = C.feltLit; ctx.fillRect(r.x + 48, iy - 32, 38, 38); bevel(ctx, r.x + 48, iy - 32, 38, 38, true);
    txt(ctx, "x", r.x + 67, iy - 2, { fam: "DejavuB", size: 34, color: C.white, align: "center" });
    txt(ctx, it, r.x + 110, iy, { fam: "VT323", size: 56, color: "#101010" });
    iy += 78;
  }
  // progress bar (leave room on the right for the % label)
  const px = r.x + 48, pw = r.w - 96, pyy = iy + 24;
  const labelW = 130, barW = pw - labelW;
  txt(ctx, "Installing awesomeness...", px, pyy - 14, { fam: "VT323", size: 40, color: "#101010" });
  ctx.fillStyle = C.white; ctx.fillRect(px, pyy + 6, barW, 50); bevel(ctx, px, pyy + 6, barW, 50, false);
  for (let i = 0; i < Math.floor((barW - 16) / 26); i++) { ctx.fillStyle = C.navy; ctx.fillRect(px + 8 + i * 26, pyy + 14, 20, 34); }
  txt(ctx, "100%", px + pw, pyy + 44, { fam: "VT323", size: 44, color: C.navy, align: "right", bold: true });
  // big button
  const btw = r.w - 96, bth = 150, btx = r.x + 48, bty = r.y + r.h - bth - 56;
  ctx.fillStyle = C.feltLit; ctx.fillRect(btx, bty, btw, bth); bevel(ctx, btx, bty, btw, bth, true);
  tri(ctx, btx + 80, bty + bth / 2, 30, C.white);
  txt(ctx, "PLAY NOW", btx + 130, bty + bth / 2 + 6, { fam: "VT323", size: 96, color: C.white, bold: true });
  txt(ctx, "BREAKBPM.COM", btx + btw - 30, bty + bth / 2 + 4, { fam: "PS2P", size: 26, color: C.amber, align: "right" });
  scanlines(ctx, r.x, r.y, r.w, r.h, 4, 0.05); // faint CRT lines only — keep the silver dialog clean
};

assets["06-hero-story"] = async (ctx, W, H) => {
  const r = windowFrame(ctx, W, H, "BreakBPM.exe");
  crtFill(ctx, r);
  publisher(ctx, r.x + r.w / 2 - measure(ctx, "SAYM SOFTWARE SYSTEMS", "PS2P", 22) / 2 - 22, r.y + 90, 22);
  txt(ctx, "EST. 1999  ·  Y2K-DELAYED", r.x + r.w / 2, r.y + 150, { fam: "VT323", size: 40, color: C.greenDim, align: "center" });
  txt(ctx, "NICE RACK,", r.x + r.w / 2, r.y + 430, { fam: "VT323", size: 190, color: C.green, align: "center", bold: true, glow: 22 });
  txt(ctx, "TRACK IT.", r.x + r.w / 2, r.y + 590, { fam: "VT323", size: 190, color: C.amber, align: "center", bold: true, glow: 22 });
  const img = await loadImage(join(PUB, "eightball_nobg.png")).catch(() => null);
  const br = 250, bx = r.x + r.w / 2, by = r.y + 980;
  if (img) ctx.drawImage(img, bx - br, by - br, br * 2, br * 2); else eightBall(ctx, bx, by, br);
  let ly = r.y + 1320;
  const lore = wrap(ctx, "Log every shot. See your accuracy and your Balls Per Minute, live. Built in the '90s. Unreleased — until now.", r.w - 120, "VT323", 52);
  for (const line of lore) { txt(ctx, line, r.x + r.w / 2, ly, { fam: "VT323", size: 52, color: C.green, align: "center" }); ly += 58; }
  ctaStrip(ctx, r);
  crtFinish(ctx, r);
};

assets["07-shark-story"] = async (ctx, W, H) => {
  const r = windowFrame(ctx, W, H, "shark.exe");
  crtFill(ctx, r);
  const img = await loadImage(join(PUB, "shark.jpg")).catch(() => null);
  if (img) {
    drawImageCover(ctx, img, r.x, r.y, r.w, r.h * 0.6);
    ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = "rgba(0,80,30,0.55)";
    ctx.fillRect(r.x, r.y, r.w, r.h * 0.6); ctx.restore();
    const grad = ctx.createLinearGradient(0, r.y, 0, r.y + r.h * 0.6);
    grad.addColorStop(0, "rgba(5,10,6,0.15)"); grad.addColorStop(1, "rgba(5,10,6,0.96)");
    ctx.fillStyle = grad; ctx.fillRect(r.x, r.y, r.w, r.h * 0.6);
  }
  publisher(ctx, r.x + 48, r.y + 80, 22);
  txt(ctx, "FACE THE", r.x + r.w / 2, r.y + r.h * 0.56, { fam: "VT323", size: 150, color: C.green, align: "center", bold: true, glow: 18 });
  txt(ctx, "SHARK", r.x + r.w / 2, r.y + r.h * 0.56 + 150, { fam: "VT323", size: 200, color: C.amber, align: "center", bold: true, glow: 22 });
  let ly = r.y + r.h * 0.78;
  const body = wrap(ctx, "Solo 8-ball vs an invisible hustler AI. Miss, and it steals the table. Two difficulties. No mercy.", r.w - 120, "VT323", 54);
  for (const line of body) { txt(ctx, line, r.x + r.w / 2, ly, { fam: "VT323", size: 54, color: C.green, align: "center" }); ly += 60; }
  ctaStrip(ctx, r, "RACK 'EM  —  BREAKBPM.COM");
  crtFinish(ctx, r);
};

assets["08-free-story"] = async (ctx, W, H) => {
  const r = windowFrame(ctx, W, H, "setup.exe");
  crtFill(ctx, r);
  publisher(ctx, r.x + r.w / 2 - measure(ctx, "SAYM SOFTWARE SYSTEMS", "PS2P", 22) / 2 - 22, r.y + 100, 22);
  txt(ctx, "FREE TO PLAY.", r.x + r.w / 2, r.y + 470, { fam: "VT323", size: 150, color: C.green, align: "center", bold: true, glow: 20 });
  txt(ctx, "NOTHING TO", r.x + r.w / 2, r.y + 620, { fam: "VT323", size: 150, color: C.amber, align: "center", bold: true, glow: 20 });
  txt(ctx, "INSTALL.", r.x + r.w / 2, r.y + 770, { fam: "VT323", size: 150, color: C.amber, align: "center", bold: true, glow: 20 });
  let ly = r.y + 920;
  const body = wrap(ctx, "Works in any browser. No download. No account needed to start. Just rack 'em and play.", r.w - 140, "VT323", 56);
  for (const line of body) { txt(ctx, line, r.x + r.w / 2, ly, { fam: "VT323", size: 56, color: C.green, align: "center" }); ly += 64; }
  // big button
  const btw = r.w - 130, bth = 180, btx = r.x + 65, bty = r.y + r.h * 0.74;
  ctx.fillStyle = C.navy; ctx.fillRect(btx, bty, btw, bth);
  ctx.strokeStyle = C.green; ctx.lineWidth = 4; ctx.save(); ctx.shadowColor = C.green; ctx.shadowBlur = 18;
  ctx.strokeRect(btx, bty, btw, bth); ctx.restore();
  tri(ctx, btx + 90, bty + bth / 2, 34, C.green);
  txt(ctx, "BREAKBPM.COM", btx + btw / 2 + 30, bty + bth / 2 + 18, { fam: "PS2P", size: 52, color: C.green, align: "center", glow: 12 });
  // swipe affordance
  tri2Down(ctx, r.x + r.w / 2, r.y + r.h - 150, 26, C.amber);
  txt(ctx, "TAP THE LINK", r.x + r.w / 2, r.y + r.h - 70, { fam: "VT323", size: 44, color: C.amber, align: "center" });
  crtFinish(ctx, r);
};

function tri2Down(ctx, cx, cy, s, color) {
  ctx.save(); ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(cx - s, cy - s / 2); ctx.lineTo(cx + s, cy - s / 2); ctx.lineTo(cx, cy + s);
  ctx.closePath(); ctx.fill(); ctx.restore();
}

// ── Run ──────────────────────────────────────────────────────────────────────
const SIZES = {
  "01-hero-square": [1080, 1080], "02-what-square": [1080, 1080],
  "03-shark-square": [1080, 1080], "04-leaderboard-square": [1080, 1080],
  "05-free-square": [1080, 1080], "06-hero-story": [1080, 1920],
  "07-shark-story": [1080, 1920], "08-free-story": [1080, 1920],
};

for (const [name, fn] of Object.entries(assets)) {
  const [W, H] = SIZES[name];
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  await fn(ctx, W, H);
  const buf = canvas.toBuffer("image/png");
  writeFileSync(join(OUT, `${name}.png`), buf);
  console.log(`✓ ${name}.png  (${W}x${H})  ${(buf.length / 1024).toFixed(0)}kb`);
}
console.log("Done →", OUT);
