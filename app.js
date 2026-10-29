import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let toastTimer = null;
let encryptSelectedFile = null; // source archive for the official package exporter
let iconSourceImage = null;
let decryptSelectedFile = null;
let glyphImage = null;
let glyphResults = null;
let inspectorFile = null;
let manifestType = 'resources';
let uuidValues = [];

function showToast(message = 'Copied to clipboard') {
  $('toastText').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2300);
}

async function copyText(text, successMessage = 'Copied to clipboard') {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const temp = document.createElement('textarea');
      temp.value = text;
      temp.style.position = 'fixed'; temp.style.opacity = '0'; temp.style.left = '-9999px';
      document.body.appendChild(temp); temp.select();
      const ok = document.execCommand('copy'); temp.remove();
      if (!ok) throw new Error('Clipboard permission was not granted.');
    }
    showToast(successMessage);
  } catch (error) {
    showToast('Clipboard blocked by the browser');
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}
function downloadText(text, filename, type = 'application/json;charset=utf-8') {
  downloadBlob(new Blob([text], { type }), filename);
}
function bytesToHex(bytes) { return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase(); }
function makeUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0'));
  return `${h.slice(0,4).join('')}-${h.slice(4,6).join('')}-${h.slice(6,8).join('')}-${h.slice(8,10).join('')}-${h.slice(10).join('')}`;
}
function randomKey(length = 32) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_';
  const bytes = new Uint8Array(length); crypto.getRandomValues(bytes);
  let key = '';
  for (let i = 0; i < bytes.length; i++) key += chars[bytes[i] % chars.length];
  return key;
}
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
function setView(view) {
  const known = ['home', 'encrypt', 'decrypt', 'server', 'glyph', 'json', 'uuid', 'manifest', 'inspector', 'icon', 'text'];
  if (!known.includes(view)) view = 'home';
  $$('.view').forEach(node => node.classList.toggle('active-view', node.id === `view-${view}`));
  $$('.nav-item').forEach(node => node.classList.toggle('active', node.dataset.view === view));
  const activeNav = $(`view-${view}`);
  const displayTitle = view === 'home' ? 'OVERVIEW' : view.replace(/([A-Z])/g, ' $1').toUpperCase();
  $('crumbCurrent').textContent = displayTitle;
  $('sidebar').classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'json') updateJsonEditorMetrics();
  if (view === 'glyph' && glyphImage) drawGlyphPreview();
  void activeNav;
}
$$('[data-view]').forEach(node => node.addEventListener('click', e => { e.preventDefault(); setView(node.dataset.view); }));
$$('[data-jump]').forEach(node => node.addEventListener('click', () => setView(node.dataset.jump)));
$('mobileMenu').addEventListener('click', () => $('sidebar').classList.toggle('open'));
document.addEventListener('click', event => {
  if (window.innerWidth <= 680 && $('sidebar').classList.contains('open') && !event.target.closest('#sidebar') && !event.target.closest('#mobileMenu')) $('sidebar').classList.remove('open');
});

// Legacy .fnpack reader: retained to restore previously created containers. New exports use official ZIP-based Bedrock formats.
const FN_MAGIC = encoder.encode('FARRNPX1');
async function deriveAESKey(passphrase, salt) {
  if (!crypto.subtle) throw new Error('Web Crypto is unavailable. Open this site over HTTPS or localhost.');
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function concatBytes(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function safeBaseName(name) { return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 180) || 'restored-pack.zip'; }

function bindDropzone(zoneId, inputId, onFile) {
  const zone = $(zoneId); const input = $(inputId);
  if (!zone || !input) return;
  ['dragenter', 'dragover'].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); zone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); zone.classList.remove('dragover'); }));
  zone.addEventListener('drop', event => { const file = event.dataTransfer?.files?.[0]; if (file) onFile(file); });
  input.addEventListener('change', () => { if (input.files?.[0]) onFile(input.files[0]); });
}
$('toggleDecryptKey').addEventListener('click', () => {
  const input = $('decryptKey');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('toggleDecryptKey').textContent = show ? 'Hide' : 'Show';
});

function updateEncryptFile(file) {
  encryptSelectedFile = file;
  $('encryptFileTitle').textContent = file.name;
  $('encryptFileMeta').textContent = `${formatSize(file.size)} · selected locally`;
  $('runEncrypt').disabled = false;
  $('encryptResult').innerHTML = '';
}
bindDropzone('encryptDrop', 'encryptFile', updateEncryptFile);
$('packOutputFormat').addEventListener('change', () => $('encryptResult').innerHTML = '');
$('runEncrypt').addEventListener('click', async () => {
  if (!encryptSelectedFile) return;
  const button = $('runEncrypt'); const oldLabel = button.innerHTML;
  button.disabled = true; button.innerHTML = 'Preparing package…'; $('encryptResult').innerHTML = '';
  try {
    if (!window.JSZip) throw new Error('The ZIP library did not load. Check your internet connection and reload this page.');
    const raw = new Uint8Array(await encryptSelectedFile.arrayBuffer());
    const inputExt = encryptSelectedFile.name.split('.').pop().toLowerCase();
    const chosenFormat = $('packOutputFormat').value;
    const base = safeBaseName(encryptSelectedFile.name.replace(/\.[^.]+$/, '') || 'bedrock-pack');
    let outBytes = raw;
    let message = '';
    let statusNote = '';
    const sourceZip = await JSZip.loadAsync(raw);
    const sourceFiles = Object.values(sourceZip.files).filter(entry => !entry.dir);
    const rootManifest = !!sourceZip.file('manifest.json');
    const nestedPacks = sourceFiles.filter(entry => /\.(mcpack|mcworld)$/i.test(entry.name));

    if (chosenFormat === 'mcpack') {
      if (inputExt === 'mcaddon' || nestedPacks.length > 0) {
        throw new Error('This archive contains bundled packs. Export it as .mcaddon, or select one individual pack to create a .mcpack file.');
      }
      const manifestAnywhere = rootManifest || sourceFiles.some(entry => /(^|\/)manifest\.json$/i.test(entry.name));
      if (!rootManifest) {
        statusNote = manifestAnywhere
          ? 'Warning: manifest.json is nested below a folder. Move it to the archive root for a standard Bedrock pack.'
          : 'Warning: no manifest.json found at the archive root. The file is packaged, but Minecraft may not import it as a valid pack.';
      } else statusNote = 'manifest.json is present at the archive root.';
      message = 'Official Bedrock pack extension · ZIP-based';
    } else if (chosenFormat === 'mcaddon') {
      if (inputExt === 'mcaddon' || nestedPacks.length > 0) {
        message = 'Addon bundle preserved · ZIP-based';
        statusNote = 'Existing bundled archive preserved without changing its contents.';
      } else {
        const innerName = `${base}.mcpack`;
        const wrapper = new JSZip();
        wrapper.file(innerName, raw, { binary: true });
        outBytes = new Uint8Array(await wrapper.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } }));
        message = 'Addon bundle created with one nested .mcpack';
        statusNote = rootManifest ? 'The source manifest is at the root of the nested pack.' : 'Warning: the nested pack did not have a root manifest.json.';
      }
    } else {
      message = 'Standard ZIP archive · original file bytes preserved';
      statusNote = 'The archive contents were not modified.';
    }
    const outputName = `${base}.${chosenFormat}`;
    const outputBlob = new Blob([outBytes], { type: 'application/zip' });
    const url = URL.createObjectURL(outputBlob);
    $('encryptResult').innerHTML = `<div class="result-card"><span class="result-file-icon">▤</span><div class="result-copy"><b>${escapeHTML(outputName)}</b><small>${formatSize(outBytes.length)} · ${escapeHTML(message)}</small></div></div><div class="result-links"><a class="download-link" href="${url}" download="${escapeAttr(outputName)}">Download ${escapeHTML(outputName)} ↓</a></div><div class="package-status-note">${escapeHTML(statusNote)}</div>`;
    showToast('Package exported');
  } catch (error) {
    $('encryptResult').innerHTML = `<div class="error-line">${escapeHTML(error.message || 'Could not package this file. Make sure it is a valid ZIP-based archive.')}</div>`;
  } finally { button.disabled = !encryptSelectedFile; button.innerHTML = oldLabel; }
});

function updateDecryptFile(file) {
  decryptSelectedFile = file;
  $('decryptFileTitle').textContent = file.name;
  $('decryptFileMeta').textContent = `${formatSize(file.size)} · encrypted container selected`;
  $('decryptSummary').innerHTML = `<span class="summary-file-icon">⌑</span><span><b>${escapeHTML(file.name)}</b><small>${formatSize(file.size)} · Ready to verify key</small></span><span class="summary-status">LOADED</span>`;
  $('runDecrypt').disabled = false;
  $('decryptResult').innerHTML = '';
}
bindDropzone('decryptDrop', 'decryptFile', updateDecryptFile);
$('decryptKey').addEventListener('input', () => $('decryptResult').innerHTML = '');
$('runDecrypt').addEventListener('click', async () => {
  if (!decryptSelectedFile) return;
  const key = $('decryptKey').value.trim();
  if (!key) { $('decryptResult').innerHTML = '<div class="error-line">Enter the key used to encrypt this file.</div>'; return; }
  const button = $('runDecrypt'); const label = button.innerHTML;
  button.disabled = true; button.innerHTML = 'Verifying and decrypting…'; $('decryptResult').innerHTML = '';
  try {
    const packed = new Uint8Array(await decryptSelectedFile.arrayBuffer());
    if (packed.length < 8 + 16 + 12 + 16 || FN_MAGIC.some((byte, i) => packed[i] !== byte)) throw new Error('This file is not a recognized compatible legacy .fnpack container.');
    const salt = packed.slice(8, 24); const iv = packed.slice(24, 36); const ciphertext = packed.slice(36);
    const aesKey = await deriveAESKey(key, salt);
    const clear = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext));
    if (clear.length < 4) throw new Error('Container payload is incomplete.');
    const nameLength = new DataView(clear.buffer, clear.byteOffset, clear.byteLength).getUint32(0, true);
    if (nameLength > clear.length - 4) throw new Error('Container metadata is invalid.');
    const name = safeBaseName(decoder.decode(clear.slice(4, 4 + nameLength)));
    const content = clear.slice(4 + nameLength);
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    $('decryptResult').innerHTML = `<div class="result-card"><span class="result-file-icon">✓</span><div class="result-copy"><b>${escapeHTML(name)}</b><small>${formatSize(content.length)} · Key verified</small></div></div><div class="result-links"><a class="download-link" href="${url}" download="${escapeAttr(name)}">Download restored archive ↓</a></div>`;
    $('decryptSummary').innerHTML = `<span class="summary-file-icon">✓</span><span><b>Key verified</b><small>Original file restored</small></span><span class="summary-status">SUCCESS</span>`;
    showToast('Archive restored successfully');
  } catch (error) {
    const message = error.name === 'OperationError' ? 'Could not decrypt this file. Check the key and confirm it is a compatible legacy .fnpack container.' : (error.message || 'Decryption failed.');
    $('decryptResult').innerHTML = `<div class="error-line">${escapeHTML(message)}</div>`;
    $('decryptSummary').innerHTML = `<span class="summary-file-icon">!</span><span><b>Verification failed</b><small>Check the selected file and key</small></span><span class="summary-status">ERROR</span>`;
  } finally { button.disabled = false; button.innerHTML = label; }
});

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}
function escapeAttr(value) { return escapeHTML(value).replace(/`/g, '&#96;'); }

// Glyph atlas generator.
bindDropzone('glyphDrop', 'glyphFile', file => {
  const image = new Image(); const url = URL.createObjectURL(file);
  image.onload = () => {
    if (glyphImage?.url) URL.revokeObjectURL(glyphImage.url);
    glyphImage = { image, url, name: file.name };
    $('glyphFileTitle').textContent = file.name;
    $('glyphFileMeta').textContent = `${image.naturalWidth} × ${image.naturalHeight} px · ${formatSize(file.size)}`;
    $('generateGlyphs').disabled = false;
    drawGlyphPreview();
    generateGlyphOutput();
  };
  image.onerror = () => { URL.revokeObjectURL(url); showToast('Could not read that image'); };
  image.src = url;
});
['glyphCellW','glyphCellH','glyphStart','glyphHeight','glyphFilePath'].forEach(id => $(id).addEventListener('input', () => { if (glyphImage) { drawGlyphPreview(); generateGlyphOutput(); } }));
function parseCodePoint(raw) {
  const text = String(raw).trim().replace(/^U\+/i, '').replace(/^0x/i, '');
  if (!/^[0-9a-f]{1,6}$/i.test(text)) throw new Error('Enter a Unicode start point like E000 or U+E000.');
  const value = parseInt(text, 16);
  if (value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) throw new Error('That Unicode value is not a valid code point.');
  return value;
}
function drawGlyphPreview() {
  if (!glyphImage) return;
  const image = glyphImage.image;
  const cellW = Math.max(1, Math.floor(Number($('glyphCellW').value) || 8));
  const cellH = Math.max(1, Math.floor(Number($('glyphCellH').value) || 8));
  const cols = Math.floor(image.naturalWidth / cellW); const rows = Math.floor(image.naturalHeight / cellH);
  const canvas = $('glyphCanvas'); const ctx = canvas.getContext('2d');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  ctx.clearRect(0,0,canvas.width,canvas.height); ctx.imageSmoothingEnabled = false; ctx.drawImage(image, 0, 0);
  ctx.save(); ctx.strokeStyle = '#c7f36c'; ctx.lineWidth = Math.max(.6, Math.min(cellW, cellH) / 10); ctx.globalAlpha = .78;
  for (let x = 0; x <= cols; x++) { ctx.beginPath(); ctx.moveTo(x * cellW + .5, 0); ctx.lineTo(x * cellW + .5, rows * cellH); ctx.stroke(); }
  for (let y = 0; y <= rows; y++) { ctx.beginPath(); ctx.moveTo(0, y * cellH + .5); ctx.lineTo(cols * cellW, y * cellH + .5); ctx.stroke(); }
  ctx.restore();
  $('glyphPreview').querySelector('.preview-empty')?.remove(); canvas.hidden = false;
  $('glyphDimensions').textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
}
function generateGlyphOutput() {
  if (!glyphImage) return;
  try {
    const image = glyphImage.image;
    const cellW = Math.floor(Number($('glyphCellW').value)); const cellH = Math.floor(Number($('glyphCellH').value));
    if (!Number.isFinite(cellW) || !Number.isFinite(cellH) || cellW < 1 || cellH < 1) throw new Error('Cell size must be a positive whole number.');
    const cols = Math.floor(image.naturalWidth / cellW); const rows = Math.floor(image.naturalHeight / cellH);
    const count = cols * rows;
    if (!cols || !rows) throw new Error('Cell size is larger than the source image.');
    if (count > 4096) throw new Error('That atlas contains more than 4096 cells. Use a smaller sheet.');
    const start = parseCodePoint($('glyphStart').value);
    if (start + count - 1 > 0x10ffff || (start <= 0xdfff && start + count - 1 >= 0xd800)) throw new Error('The selected range exceeds valid Unicode code points.');
    const chars = Array.from({ length: count }, (_, i) => String.fromCodePoint(start + i));
    const rowStrings = [];
    for (let y=0; y<rows; y++) rowStrings.push(chars.slice(y*cols, (y+1)*cols).join(''));
    const filePath = $('glyphFilePath').value.trim() || 'font/glyphs/ranks.png';
    const fontHeight = Math.max(1, Math.min(64, Math.floor(Number($('glyphHeight').value) || cellH)));
    const provider = { providers: [{ type: 'bitmap', file: filePath, ascent: fontHeight, height: fontHeight, chars: rowStrings }] };
    glyphResults = { chars, provider, rowStrings, cols, rows, start, count };
    $('glyphUnicode').value = chars.join('');
    $('glyphProvider').value = JSON.stringify(provider, null, 2);
    $('glyphCount').textContent = String(count);
    $('glyphGrid').textContent = `${cols} × ${rows}`;
    $('glyphRange').textContent = `U+${start.toString(16).toUpperCase().padStart(4,'0')}–${(start+count-1).toString(16).toUpperCase().padStart(4,'0')}`;
    $('glyphCharCount').textContent = `${count} chars`;
    ['copyAllUnicode','copyProvider','downloadProvider'].forEach(id => $(id).disabled = false);
    $('generateGlyphs').textContent = 'Refresh Unicode map ↗';
  } catch (error) {
    glyphResults = null;
    ['copyAllUnicode','copyProvider','downloadProvider'].forEach(id => $(id).disabled = true);
    $('glyphCount').textContent = '—'; $('glyphGrid').textContent = '— × —'; $('glyphRange').textContent = '—';
    $('glyphUnicode').value = ''; $('glyphProvider').value = '';
    showToast(error.message);
  }
}
$('generateGlyphs').addEventListener('click', generateGlyphOutput);
$('copyAllUnicode').addEventListener('click', () => glyphResults && copyText(glyphResults.chars.join(''), 'All Unicode characters copied'));
$('copyProvider').addEventListener('click', () => glyphResults && copyText(JSON.stringify(glyphResults.provider, null, 2), 'Bitmap provider JSON copied'));
$('downloadProvider').addEventListener('click', () => glyphResults && downloadText(JSON.stringify(glyphResults.provider, null, 2), 'bitmap-provider.json'));

// JSON maker.
const jsonTemplates = {
  blank: { example: true, note: 'Replace this with your Bedrock JSON' },
  manifest: { format_version: 2, header: { name: 'My Resource Pack', description: 'Created with MCTools.', uuid: '00000000-0000-4000-8000-000000000000', version: [1, 0, 0], min_engine_version: [1, 20, 0] }, modules: [{ type: 'resources', uuid: '00000000-0000-4000-8000-000000000001', version: [1, 0, 0] }] },
  font: { providers: [{ type: 'bitmap', file: 'font/glyphs/ranks.png', ascent: 8, height: 8, chars: [String.fromCodePoint(0xE000, 0xE001, 0xE002)] }] },
  item: { format_version: '1.20.80', 'minecraft:item': { description: { identifier: 'mctools:custom_item', menu_category: { category: 'items' } }, components: { 'minecraft:icon': 'custom_item', 'minecraft:max_stack_size': 64 } } },
  recipe: { format_version: '1.20.10', 'minecraft:recipe_shaped': { description: { identifier: 'mctools:example_recipe' }, tags: ['crafting_table'], pattern: ['XX', ' X'], key: { X: { item: 'minecraft:iron_ingot' } }, result: { item: 'minecraft:iron_block', count: 1 } } },
  loot: { pools: [{ rolls: 1, entries: [{ type: 'item', name: 'minecraft:emerald', weight: 1 }] }] }
};
function updateJsonEditorMetrics() {
  const lines = $('jsonInput').value.split('\n').length;
  $('jsonGutter').textContent = Array.from({ length: lines }, (_, i) => i+1).join('\n');
  $('jsonLineCount').textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
}
function setJsonStatus(status, message) {
  $('jsonStatus').textContent = status; $('jsonStatus').classList.toggle('error', status === 'INVALID'); $('jsonStatus').classList.toggle('valid', status === 'VALID'); $('jsonMessage').textContent = message;
}
$('jsonInput').addEventListener('input', () => { updateJsonEditorMetrics(); $('jsonStatus').textContent = 'EDITING'; $('jsonStatus').classList.remove('error','valid'); $('jsonMessage').textContent = 'Changes not validated yet'; });
$('jsonTemplate').addEventListener('change', () => {
  const val = $('jsonTemplate').value;
  $('jsonInput').value = JSON.stringify(jsonTemplates[val] || {}, null, 2);
  setJsonStatus('READY', 'Template loaded'); updateJsonEditorMetrics();
});
$('jsonFormat').addEventListener('click', () => {
  try { $('jsonInput').value = JSON.stringify(JSON.parse($('jsonInput').value), null, 2); setJsonStatus('VALID', 'Formatted JSON is valid'); updateJsonEditorMetrics(); }
  catch (e) { setJsonStatus('INVALID', e.message); showToast('JSON could not be formatted'); }
});
$('jsonMinify').addEventListener('click', () => {
  try { $('jsonInput').value = JSON.stringify(JSON.parse($('jsonInput').value)); setJsonStatus('VALID', 'Minified JSON is valid'); updateJsonEditorMetrics(); }
  catch (e) { setJsonStatus('INVALID', e.message); showToast('JSON could not be minified'); }
});
$('jsonValidate').addEventListener('click', () => {
  try { JSON.parse($('jsonInput').value); setJsonStatus('VALID', 'JSON syntax looks good'); showToast('JSON validated'); }
  catch (e) { setJsonStatus('INVALID', e.message); showToast('JSON validation failed'); }
});
$('jsonCopy').addEventListener('click', () => copyText($('jsonInput').value, 'JSON copied'));
$('jsonDownload').addEventListener('click', () => {
  try { const text = JSON.stringify(JSON.parse($('jsonInput').value), null, 2); downloadText(text, 'mctools-data.json'); setJsonStatus('VALID', 'Downloaded formatted JSON'); }
  catch (e) { setJsonStatus('INVALID', e.message); showToast('Invalid JSON — fix it before downloading'); }
});

// UUID generator.
function updateUUIDCount(value) { const n = Math.max(1, Math.min(50, Math.floor(Number(value) || 1))); $('uuidCount').value = n; $('uuidCountRange').value = n; }
$('uuidCount').addEventListener('input', e => updateUUIDCount(e.target.value));
$('uuidCountRange').addEventListener('input', e => updateUUIDCount(e.target.value));
$('runUUID').addEventListener('click', () => {
  const count = Math.max(1, Math.min(50, Math.floor(Number($('uuidCount').value) || 1)));
  uuidValues = Array.from({ length: count }, makeUUID);
  $('uuidOutput').innerHTML = '';
  uuidValues.forEach((uuid, i) => {
    const row = document.createElement('div'); row.className = 'uuid-row';
    const index = document.createElement('span'); index.className = 'uuid-index'; index.textContent = String(i+1).padStart(2,'0');
    const code = document.createElement('code'); code.textContent = uuid;
    const copy = document.createElement('button'); copy.type='button'; copy.textContent='⧉'; copy.title='Copy UUID'; copy.addEventListener('click', () => copyText(uuid, 'UUID copied'));
    row.append(index, code, copy); $('uuidOutput').appendChild(row);
  });
  $('uuidOutputCount').textContent = `${count} ${count === 1 ? 'identifier' : 'identifiers'}`;
  $('copyUUIDs').disabled = false; $('downloadUUIDs').disabled = false;
  showToast(`${count} UUID${count === 1 ? '' : 's'} generated`);
});
$('copyUUIDs').addEventListener('click', () => uuidValues.length && copyText(uuidValues.join('\n'), 'All UUIDs copied'));
$('downloadUUIDs').addEventListener('click', () => uuidValues.length && downloadText(uuidValues.join('\n') + '\n', 'uuids.txt', 'text/plain;charset=utf-8'));

// Manifest maker.
function parseVersion(value, fallback) {
  const parts = String(value).trim().split('.').map(v => Number(v));
  if (parts.length !== 3 || parts.some(v => !Number.isInteger(v) || v < 0 || v > 2147483647)) return fallback;
  return parts;
}
function updateManifestPreview() {
  $('manifestPreviewName').textContent = $('manifestName').value.trim() || 'Untitled Pack';
  $('manifestPreviewType').textContent = `${manifestType === 'resources' ? 'RESOURCE PACK' : 'BEHAVIOR PACK'} · FORMAT VERSION 2`;
}
function buildManifest() {
  const type = manifestType;
  const manifest = {
    format_version: 2,
    header: {
      name: $('manifestName').value.trim() || 'Untitled Pack',
      description: $('manifestDescription').value.trim() || 'Created with MCTools.',
      uuid: $('manifestHeaderUUID').value,
      version: parseVersion($('manifestVersion').value, [1,0,0]),
      min_engine_version: parseVersion($('manifestMinEngine').value, [1,20,0])
    },
    modules: [{ type, uuid: $('manifestModuleUUID').value, version: parseVersion($('manifestVersion').value, [1,0,0]) }]
  };
  $('manifestOutput').value = JSON.stringify(manifest, null, 2);
  updateManifestPreview();
  return manifest;
}
$$('#manifestType button').forEach(button => button.addEventListener('click', () => {
  manifestType = button.dataset.type; $$('#manifestType button').forEach(item => item.classList.toggle('selected', item === button)); buildManifest();
}));
['manifestName','manifestDescription','manifestVersion','manifestMinEngine'].forEach(id => $(id).addEventListener('input', () => { updateManifestPreview(); }));
$('refreshHeaderUUID').addEventListener('click', () => { $('manifestHeaderUUID').value = makeUUID(); buildManifest(); showToast('Header UUID refreshed'); });
$('refreshModuleUUID').addEventListener('click', () => { $('manifestModuleUUID').value = makeUUID(); buildManifest(); showToast('Module UUID refreshed'); });
$('buildManifest').addEventListener('click', () => { buildManifest(); showToast('Manifest built'); });
$('copyManifest').addEventListener('click', () => copyText(buildManifest() && $('manifestOutput').value, 'Manifest JSON copied'));
$('downloadManifest').addEventListener('click', () => { buildManifest(); downloadText($('manifestOutput').value, 'manifest.json'); });
$$('[data-copy-input]').forEach(button => button.addEventListener('click', () => copyText($(button.dataset.copyInput).value, 'UUID copied')));

// Pack inspector.
bindDropzone('inspectDrop', 'inspectFile', async file => {
  inspectorFile = file; $('inspectFileTitle').textContent = file.name; $('inspectFileMeta').textContent = `${formatSize(file.size)} · Reading archive…`;
  $('inspectorResults').innerHTML = '<div class="empty-output"><span>◌</span><b>Reading archive…</b><small>Inspecting files locally.</small></div>';
  try {
    if (!window.JSZip) throw new Error('ZIP library did not load. Check your internet connection and reload the page.');
    const zip = await JSZip.loadAsync(file);
    const files = Object.values(zip.files).filter(item => !item.dir).sort((a,b) => a.name.localeCompare(b.name));
    let manifestEntry = zip.file('manifest.json');
    if (!manifestEntry) manifestEntry = files.find(item => /(^|\/)manifest\.json$/i.test(item.name));
    let manifestHTML = '<div class="inspect-manifest"><div class="manifest-preview-head"><span class="manifest-file-icon">{ }</span><div><b>No manifest.json found</b><small>CHECK PACK ROOT OR ARCHIVE WRAPPER</small></div></div><pre>Bedrock packs commonly include a manifest.json. This archive may be nested in an extra folder or may not be a standard Bedrock pack.</pre></div>';
    if (manifestEntry) {
      try {
        const parsed = JSON.parse(await manifestEntry.async('text'));
        const pretty = JSON.stringify(parsed, null, 2);
        const name = parsed?.header?.name || 'Unnamed pack';
        const ver = Array.isArray(parsed?.header?.version) ? parsed.header.version.join('.') : 'unknown version';
        manifestHTML = `<div class="inspect-manifest"><div class="manifest-preview-head"><span class="manifest-file-icon">{ }</span><div><b>${escapeHTML(name)}</b><small>MANIFEST · VERSION ${escapeHTML(ver)}</small></div><span class="manifest-valid"><i></i> JSON VALID</span></div><pre>${escapeHTML(pretty)}</pre></div>`;
      } catch (error) {
        manifestHTML = `<div class="inspect-manifest"><div class="manifest-preview-head"><span class="manifest-file-icon">!</span><div><b>manifest.json is invalid</b><small>JSON PARSE ERROR</small></div></div><pre>${escapeHTML(error.message)}</pre></div>`;
      }
    }
    const totalBytes = files.reduce((total, item) => total + (item._data?.uncompressedSize || 0), 0);
    const images = files.filter(item => /\.(png|jpg|jpeg|webp)$/i.test(item.name)).length;
    const jsons = files.filter(item => /\.json$/i.test(item.name)).length;
    const counts = `<div class="inspect-metrics"><div><small>FILES</small><b>${files.length}</b></div><div><small>JSON FILES</small><b>${jsons}</b></div><div><small>IMAGES</small><b>${images}</b></div><div><small>ARCHIVE SIZE</small><b>${formatSize(file.size)}</b></div></div>`;
    const rows = files.slice(0, 120).map(item => `<div class="file-row"><span class="file-glyph">${/\.json$/i.test(item.name) ? '{ }' : /\.(png|jpg|jpeg|webp)$/i.test(item.name) ? '▧' : '·'}</span><span class="file-name">${escapeHTML(item.name)}</span><small>${formatSize(item._data?.uncompressedSize || 0)}</small></div>`).join('');
    $('inspectorResults').innerHTML = counts + manifestHTML + `<div class="file-list"><div class="file-list-head"><span>ARCHIVE CONTENTS</span><span>${Math.min(files.length,120)} / ${files.length} FILES</span></div><div class="file-list-rows">${rows || '<div class="file-row">No files found.</div>'}</div></div>`;
    $('inspectFileMeta').textContent = `${formatSize(file.size)} · ${files.length} files · ${formatSize(totalBytes)} uncompressed`;
    showToast('Archive inspected');
  } catch (error) {
    $('inspectorResults').innerHTML = `<div class="error-line">${escapeHTML(error.message || 'Could not read this archive.')}</div>`;
    $('inspectFileMeta').textContent = `${formatSize(file.size)} · Could not inspect`;
  }
});

// Local 3D head preview from the uploaded 64x64 skin texture.
// Pack icon maker: client-side 256x256 PNG output.
function drawFittedImage(ctx, image, width, height, mode, background) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = background || '#101710';
  ctx.fillRect(0, 0, width, height);
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  if (!iw || !ih) return;
  if (mode === 'stretch') {
    ctx.drawImage(image, 0, 0, width, height);
    return;
  }
  const scale = mode === 'contain' ? Math.min(width / iw, height / ih) : Math.max(width / iw, height / ih);
  const dw = iw * scale, dh = ih * scale;
  ctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
}
function renderPackIcon() {
  if (!iconSourceImage) return;
  const canvas = $('iconCanvas');
  const ctx = canvas.getContext('2d');
  const factor = Math.max(1, Number($('iconPixelation').value) || 1);
  $('iconPixelLabel').textContent = factor === 1 ? '1× smooth' : `${factor}× pixel`;
  const lowSize = Math.max(16, Math.round(256 / factor));
  const temp = document.createElement('canvas');
  temp.width = lowSize; temp.height = lowSize;
  const tctx = temp.getContext('2d');
  tctx.imageSmoothingEnabled = factor === 1;
  drawFittedImage(tctx, iconSourceImage.image, lowSize, lowSize, $('iconFit').value, $('iconBg').value);
  ctx.clearRect(0, 0, 256, 256);
  ctx.imageSmoothingEnabled = factor === 1;
  ctx.drawImage(temp, 0, 0, 256, 256);
  $('downloadPackIcon').disabled = false;
}
bindDropzone('iconDrop', 'iconFile', file => {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    if (iconSourceImage?.url) URL.revokeObjectURL(iconSourceImage.url);
    iconSourceImage = { image, url, name: file.name };
    $('iconFileTitle').textContent = file.name;
    $('iconFileMeta').textContent = `${image.naturalWidth} × ${image.naturalHeight} px · ${formatSize(file.size)}`;
    $('downloadPackIcon').disabled = false;
    renderPackIcon();
  };
  image.onerror = () => { URL.revokeObjectURL(url); showToast('Could not read that image'); };
  image.src = url;
});
['iconFit', 'iconBg', 'iconPixelation'].forEach(id => $(id).addEventListener('input', renderPackIcon));
$('downloadPackIcon').addEventListener('click', () => {
  if (!iconSourceImage) return;
  $('iconCanvas').toBlob(blob => {
    if (!blob) { showToast('Could not export PNG'); return; }
    downloadBlob(blob, 'pack_icon.png');
    showToast('pack_icon.png exported');
  }, 'image/png');
});

// Minecraft Bedrock text / section-sign formatter.
function buildFormattedMinecraftText() {
  const text = $('mcTextInput').value;
  const color = $('mcTextColor').value;
  const codes = [color];
  if ($('mcBold').checked) codes.push('§l');
  if ($('mcItalic').checked) codes.push('§o');
  if ($('mcUnderline').checked) codes.push('§n');
  if ($('mcStrike').checked) codes.push('§m');
  const formatted = `${codes.join('')}${text}`;
  const mode = $('mcTextMode').value;
  let output = formatted;
  const payload = JSON.stringify({ rawtext: [{ text: formatted }] });
  if (mode === 'tellraw') output = `tellraw @a ${payload}`;
  else if (mode === 'title') output = `titleraw @a title ${payload}`;
  else if (mode === 'subtitle') output = `titleraw @a subtitle ${payload}`;
  $('mcTextOutput').value = output;
  const preview = $('mcTextPreview');
  preview.textContent = text || 'Preview text';
  const palette = {
    '§0':'#000000','§1':'#0000aa','§2':'#00aa00','§3':'#00aaaa','§4':'#aa0000','§5':'#aa00aa','§6':'#ffaa00','§7':'#aaaaaa',
    '§8':'#555555','§9':'#5555ff','§a':'#55ff55','§b':'#55ffff','§c':'#ff5555','§d':'#ff55ff','§e':'#ffff55','§f':'#ffffff'
  };
  preview.style.color = palette[color] || '#ffffff';
  preview.style.fontWeight = $('mcBold').checked ? '700' : '400';
  preview.style.fontStyle = $('mcItalic').checked ? 'italic' : 'normal';
  const decorations = [];
  if ($('mcUnderline').checked) decorations.push('underline');
  if ($('mcStrike').checked) decorations.push('line-through');
  preview.style.textDecoration = decorations.join(' ') || 'none';
}
['mcTextInput','mcTextColor','mcBold','mcItalic','mcUnderline','mcStrike','mcTextMode'].forEach(id => $(id).addEventListener('input', buildFormattedMinecraftText));
$('copyMcText').addEventListener('click', () => copyText($('mcTextOutput').value, 'Minecraft text copied'));
$('downloadMcText').addEventListener('click', () => downloadText($('mcTextOutput').value, 'minecraft-text.txt', 'text/plain;charset=utf-8'));
buildFormattedMinecraftText();

async function initSkinViewer() {
  const stage = $('skinStage');
  try {
    const response = await fetch('assets/Mason_customSlim.png');
    if (!response.ok) throw new Error('Skin texture not found');
    const blob = await response.blob();
    const skin = await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = URL.createObjectURL(blob); });
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D preview of the Minecraft skin head');
    stage.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, stage.clientWidth / stage.clientHeight, .1, 30);
    camera.position.set(2.15, 1.38, 3.5); camera.lookAt(0, .02, 0);
    scene.add(new THREE.HemisphereLight(0xe5ffd7, 0x293b2f, 2.0));
    const keyLight = new THREE.DirectionalLight(0xd9ffb4, 3.0); keyLight.position.set(3, 5, 4); scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x8ba8bf, 1.0); fillLight.position.set(-4, 1, -2); scene.add(fillLight);
    const faceTexture = (x, y, w=8, h=8) => {
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(skin, x, y, w, h, 0, 0, w, h);
      const texture = new THREE.CanvasTexture(canvas); texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true; return texture;
    };
    const makeFaceMaterials = (offsetX, offsetY) => [
      new THREE.MeshStandardMaterial({ map: faceTexture(offsetX, 8 + offsetY), roughness: .92 }), // right
      new THREE.MeshStandardMaterial({ map: faceTexture(16 + offsetX, 8 + offsetY), roughness: .92 }), // left
      new THREE.MeshStandardMaterial({ map: faceTexture(8 + offsetX, offsetY), roughness: .92 }), // top
      new THREE.MeshStandardMaterial({ map: faceTexture(16 + offsetX, offsetY), roughness: .92 }), // bottom
      new THREE.MeshStandardMaterial({ map: faceTexture(8 + offsetX, 8 + offsetY), roughness: .92 }), // front
      new THREE.MeshStandardMaterial({ map: faceTexture(24 + offsetX, 8 + offsetY), roughness: .92 }) // back
    ];
    const head = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), makeFaceMaterials(0, 0)); head.add(base);
    const overlayMaterials = makeFaceMaterials(32, 0);
    overlayMaterials.forEach(material => { material.transparent = true; material.alphaTest = .02; material.depthWrite = false; });
    const overlay = new THREE.Mesh(new THREE.BoxGeometry(1.045, 1.045, 1.045), overlayMaterials); head.add(overlay);
    head.rotation.y = -.35; head.rotation.x = -.04; scene.add(head);
    const resize = () => {
      const width = Math.max(1, stage.clientWidth); const height = Math.max(1, stage.clientHeight);
      renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(stage);
    let pointerX = 0, pointerY = 0; let idle = 0;
    stage.addEventListener('pointermove', event => { const r = stage.getBoundingClientRect(); pointerX = ((event.clientX - r.left) / r.width - .5) * .4; pointerY = ((event.clientY - r.top) / r.height - .5) * .18; });
    stage.addEventListener('pointerleave', () => { pointerX = 0; pointerY = 0; });
    const animate = () => {
      requestAnimationFrame(animate); idle += .0035;
      head.rotation.y += (pointerX + Math.sin(idle) * .09 - head.rotation.y) * .035;
      head.rotation.x += (pointerY - .035 - head.rotation.x) * .035;
      renderer.render(scene, camera);
    };
    animate();
  } catch (error) {
    const fallback = stage.querySelector('.skin-fallback');
    if (fallback) fallback.style.display = 'block';
  }
}

// Initial state.
$('manifestHeaderUUID').value = makeUUID();
$('manifestModuleUUID').value = makeUUID();
buildManifest();
updateJsonEditorMetrics();
initSkinViewer();
