'use strict';
// Draws Torque's icons from its mark: τ, the symbol for torque, its foot turning as torque turns a shaft, light on the
// app's ink. The mark's outline lives in ui/sim-video.js (MARK, squircle), which also draws it on a video's end card.
//
//   npx electron tools/icons.cjs
//
// It writes, from that one outline:
//   ui/icon.svg                     the scalable icon (Linux's menu icon, and the source to look at)
//   ui/icon.png, ui/icon.ico        the window and Windows icons: the rounded square filling the canvas
//   ui/icon.icns                    the Mac icon: the rounded square on Apple's grid (824 of 1024) with a soft shadow
//   packaging/installer.ico         Setup's own icon: the mark on a circle, so it is not mistaken for the app
//   packaging/installer-sidebar.bmp Setup's Welcome and Finish sidebar (164 × 314, as NSIS Modern UI draws it)
// Electron's Chromium draws the pictures, so no image library is needed.
const fs = require('node:fs'), path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const { MARK, squircle, INK, PAPER } = require(path.join(ROOT, 'ui', 'sim-video.js'));

const icon = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="${squircle(0, 0, 64, 64)}" fill="${INK}"/><path d="${MARK}" fill="${PAPER}"/></svg>`;
// Apple's grid: the body is 824 of 1024 with 100 on each side, and a shadow under it, as the system's own icons have.
const macIcon = () => { const k = 824 / 1024, o = 100 / 1024 * 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><filter id="s" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur in="SourceAlpha" stdDeviation="1.1"/><feOffset dy=".75"/><feComponentTransfer><feFuncA type="linear" slope=".4"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g transform="translate(${o} ${o}) scale(${k})"><path d="${squircle(0, 0, 64, 64)}" fill="${INK}" filter="url(#s)"/><path d="${MARK}" fill="${PAPER}"/></g></svg>`; };
const roundIcon = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="${INK}"/><path d="${MARK}" fill="${PAPER}" transform="translate(32 32.5) scale(.86) translate(-32 -32.5)"/></svg>`;

// ---------------------------------------------------------------- file formats
// ICO with 32-bit BMP pictures (NSIS takes no PNG inside an icon), largest last as Windows lists them.
function ico(pictures) {
  const head = Buffer.alloc(6 + 16 * pictures.length), bodies = [];let offset = head.length;
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pictures.length, 4);
  pictures.forEach(({ n, rgba }, i) => {
    const maskRow = Math.ceil(n / 32) * 4, info = Buffer.alloc(40), pixels = Buffer.alloc(n * n * 4), mask = Buffer.alloc(maskRow * n);
    info.writeUInt32LE(40, 0); info.writeInt32LE(n, 4); info.writeInt32LE(n * 2, 8); info.writeUInt16LE(1, 12); info.writeUInt16LE(32, 14); info.writeUInt32LE(pixels.length + mask.length, 20);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const from = (y * n + x) * 4, to = ((n - 1 - y) * n + x) * 4, a = rgba[from + 3];
      pixels[to] = rgba[from + 2]; pixels[to + 1] = rgba[from + 1]; pixels[to + 2] = rgba[from]; pixels[to + 3] = a;
      if (a === 0) mask[(n - 1 - y) * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
    const body = Buffer.concat([info, pixels, mask]), e = 6 + 16 * i;
    head.writeUInt8(n >= 256 ? 0 : n, e); head.writeUInt8(n >= 256 ? 0 : n, e + 1); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(body.length, e + 8); head.writeUInt32LE(offset, e + 12); offset += body.length; bodies.push(body);
  });
  return Buffer.concat([head, ...bodies]);
}
// ICNS with the types macOS's own iconutil writes: PNG for 32 px and up, and for 16 and 32 at 1x ("ic04", "ic05")
// the pixels as ARGB, each channel run-length coded on its own.
const ICNS = [['ic04', 16, 'argb'], ['ic11', 32], ['ic05', 32, 'argb'], ['ic12', 64], ['ic07', 128], ['ic13', 256], ['ic08', 256], ['ic14', 512], ['ic09', 512], ['ic10', 1024]];
// icns run-length coding: a byte under 0x80 is followed by that many plus one bytes as they are; 0x80 and up repeats
// the next byte (that minus 0x80, plus three) times.
function packbits(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length;) {
    let run = 1; while (i + run < bytes.length && run < 130 && bytes[i + run] === bytes[i]) run++;
    if (run >= 3) { out.push(0x80 + run - 3, bytes[i]); i += run; continue; }
    const lit = []; while (i < bytes.length && lit.length < 128 && !(i + 2 < bytes.length && bytes[i] === bytes[i + 1] && bytes[i] === bytes[i + 2])) lit.push(bytes[i++]);
    out.push(lit.length - 1, ...lit);
  }
  return Buffer.from(out);
}
function argb(rgba) { const n = rgba.length / 4, ch = k => Uint8Array.from({ length: n }, (_, i) => rgba[i * 4 + k]); return Buffer.concat([Buffer.from('ARGB', 'latin1'), packbits(ch(3)), packbits(ch(0)), packbits(ch(1)), packbits(ch(2))]); }
function icns(pictureOf) {
  const parts = ICNS.map(([type, n, kind]) => { const p = pictureOf(n), data = kind === 'argb' ? argb(p.rgba) : p.png, h = Buffer.alloc(8); h.write(type, 0, 'latin1'); h.writeUInt32BE(data.length + 8, 4); return Buffer.concat([h, data]); });
  const head = Buffer.alloc(8); head.write('icns', 0, 'latin1'); head.writeUInt32BE(8 + parts.reduce((t, p) => t + p.length, 0), 4);
  return Buffer.concat([head, ...parts]);
}
// A 24-bit BMP, bottom row first, as NSIS expects its bitmaps.
function bmp(w, h, rgba) {
  const row = Math.ceil(w * 3 / 4) * 4, data = Buffer.alloc(row * h), head = Buffer.alloc(54);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const from = (y * w + x) * 4, to = (h - 1 - y) * row + x * 3; data[to] = rgba[from + 2]; data[to + 1] = rgba[from + 1]; data[to + 2] = rgba[from]; }
  head.write('BM', 0, 'latin1'); head.writeUInt32LE(54 + data.length, 2); head.writeUInt32LE(54, 10); head.writeUInt32LE(40, 14); head.writeInt32LE(w, 18); head.writeInt32LE(h, 22);
  head.writeUInt16LE(1, 26); head.writeUInt16LE(24, 28); head.writeUInt32LE(data.length, 34); head.writeInt32LE(2835, 38); head.writeInt32LE(2835, 42);
  return Buffer.concat([head, data]);
}

// ---------------------------------------------------------------- drawing, in a hidden window
// Draws an SVG at n × n and returns its PNG and its pixels.
function raster(svg, n) {
  return new Promise((ok, fail) => { const img = new Image(); img.onerror = () => fail(Error('could not draw the icon'));
    img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = n; const x = c.getContext('2d'); x.drawImage(img, 0, 0, n, n);
      const px = x.getImageData(0, 0, n, n).data; let s = ''; for (let i = 0; i < px.length; i += 8192) s += String.fromCharCode.apply(null, px.subarray(i, i + 8192));
      ok({ png: c.toDataURL('image/png').split(',')[1], rgba: btoa(s) }); };
    img.src = 'data:image/svg+xml;base64,' + btoa(svg); });
}
// The installer's sidebar: the mark at the top, the name at the bottom, in the app's display face, on its ink.
function sidebar({ w, h, mark, ink, paper, font }) {
  return (async () => {
    const face = new FontFace('Barlow Condensed', Uint8Array.from(atob(font), c => c.charCodeAt(0)).buffer, { weight: '700' }); await face.load(); document.fonts.add(face);
    const c = document.createElement('canvas'), k = 4; c.width = w * k; c.height = h * k; const x = c.getContext('2d'); x.scale(k, k);
    x.fillStyle = ink; x.fillRect(0, 0, w, h);
    x.save(); x.translate(22, 26); x.scale(52 / 64, 52 / 64); x.translate(-12, -14); x.fillStyle = paper; x.fill(new Path2D(mark)); x.restore();
    x.fillStyle = paper; x.font = '700 34px "Barlow Condensed"'; x.textBaseline = 'alphabetic'; x.fillText('Torque', 21, h - 24);
    const out = document.createElement('canvas'); out.width = w; out.height = h; const o = out.getContext('2d'); o.imageSmoothingQuality = 'high'; o.drawImage(c, 0, 0, w, h);
    const px = o.getImageData(0, 0, w, h).data; let s = ''; for (let i = 0; i < px.length; i += 8192) s += String.fromCharCode.apply(null, px.subarray(i, i + 8192)); return btoa(s);
  })();
}

if (!process.versions.electron) { console.error('Run it with Electron: npx electron tools/icons.cjs'); process.exit(1); }
const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await win.loadURL('about:blank');
    const draw = async (svg, n) => { const r = await win.webContents.executeJavaScript(`(${raster})(${JSON.stringify(svg)},${n})`); return { n, png: Buffer.from(r.png, 'base64'), rgba: Buffer.from(r.rgba, 'base64') }; };
    const write = (rel, bytes) => { fs.writeFileSync(path.join(ROOT, rel), bytes); console.log('wrote', rel, bytes.length, 'bytes'); };
    const SIZES = [16, 24, 32, 48, 64, 128, 256];
    write('ui/icon.svg', Buffer.from(icon() + '\n'));
    write('ui/icon.png', (await draw(icon(), 1024)).png);
    const full = []; for (const n of SIZES) full.push(await draw(icon(), n)); write('ui/icon.ico', ico(full));
    const mac = new Map(); for (const n of new Set(ICNS.map(([, n]) => n))) mac.set(n, await draw(macIcon(), n)); write('ui/icon.icns', icns(n => mac.get(n)));
    const round = []; for (const n of SIZES) round.push(await draw(roundIcon(), n)); write('packaging/installer.ico', ico(round));
    const font = fs.readFileSync(path.join(ROOT, 'ui', 'fonts', 'barlow-condensed-700-latin.woff2')).toString('base64');
    const side = await win.webContents.executeJavaScript(`(${sidebar})(${JSON.stringify({ w: 164, h: 314, mark: MARK, ink: INK, paper: PAPER, font })})`);
    write('packaging/installer-sidebar.bmp', bmp(164, 314, Buffer.from(side, 'base64')));
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { win.destroy(); app.quit(); }
});
