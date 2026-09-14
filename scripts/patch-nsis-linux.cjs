/* Enables the wine-free uninstaller-extraction path in electron-builder on Linux.
 *
 * electron-builder's NSIS target runs the freshly-built installer under wine to
 * extract the uninstaller. That requires 32-bit wine (WoW64), which most Linux
 * build environments lack. UninstallerReader.exec — the code path used on
 * macOS Catalina for the same reason — performs identical extraction in Node
 * without wine. This patch selects that path on Linux only; Windows and macOS
 * behavior is unchanged.
 *
 * Idempotent and fail-safe: exits 0 with a notice if app-builder-lib is absent
 * or upstream code changed shape. Wired via the package.json "postinstall" hook
 * so `bun install` / `npm install` reproducibly produces a Linux-buildable tree. */
'use strict';
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'node_modules', 'app-builder-lib', 'out', 'targets', 'nsis', 'NsisTarget.js');
if (!fs.existsSync(target)) {
  console.log('[patch-nsis-linux] app-builder-lib not installed; skipping');
  process.exit(0);
}

let src = fs.readFileSync(target, 'utf8');
const anchor = 'if ((0, macosVersion_1.isMacOsCatalina)()) {';
const patched = 'if ((0, macosVersion_1.isMacOsCatalina)() || process.platform === "linux") {';

if (src.includes(patched)) {
  console.log('[patch-nsis-linux] already patched');
  process.exit(0);
}
if (!src.includes(anchor)) {
  console.log('[patch-nsis-linux] anchor not found (upstream changed); skipping without error');
  process.exit(0);
}

src = src.split(anchor).join(patched);
fs.writeFileSync(target, src);
console.log('[patch-nsis-linux] NsisTarget.js patched: wine-free uninstaller extraction on Linux');
