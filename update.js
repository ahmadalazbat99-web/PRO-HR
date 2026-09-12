const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function getUpdateState(baseDir) {
  const file = path.join(baseDir, 'update-state.json');
  try { if (!fs.existsSync(file)) return { channel: 'stable', autoCheck: true, lastCheck: null }; return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return { channel: 'stable', autoCheck: true, lastCheck: null }; }
}
function saveUpdateState(baseDir, state) {
  const file = path.join(baseDir, 'update-state.json');
  const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8'); fs.renameSync(tmp, file);
}
function verifyUpdateManifest(manifest, publicKeyPem) {
  if (!manifest || !manifest.version || !manifest.signature || !publicKeyPem) return { ok: false, reason: 'UPDATE_SIGNATURE_REQUIRED' };
  const body = JSON.stringify({ version: manifest.version, url: manifest.url || '', sha512: manifest.sha512 || '', channel: manifest.channel || 'stable' });
  try { const v = crypto.createVerify('SHA256'); v.update(body); v.end(); return v.verify(publicKeyPem, Buffer.from(manifest.signature, 'base64')) ? { ok: true, version: manifest.version } : { ok: false, reason: 'INVALID_UPDATE_SIGNATURE' }; }
  catch { return { ok: false, reason: 'UPDATE_SIGNATURE_ERROR' }; }
}
module.exports = { getUpdateState, saveUpdateState, verifyUpdateManifest };
