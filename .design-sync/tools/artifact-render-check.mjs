import { chromium } from 'playwright';
// Render-check the Design System artifact previews headless, loading what the
// artifact frame preloads (tokens.css, bundle.css, React, bundle.js).
// Usage, from .ds-sync/ (for playwright): node <this> <dest-dir>/project <png-out-dir>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const P = process.argv[2], OUT = process.argv[3];
const comps = readdirSync(P + '/components', { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== 'lib').map(d => d.name);
const b = await chromium.launch(); const res = [];
for (const c of comps) {
  let html = readFileSync(`${P}/components/${c}/preview.html`, 'utf8');
  const pre = `<link rel="stylesheet" href="../../tokens.css"><link rel="stylesheet" href="../bundle.css">
<script src="../lib/react.js"></script><script src="../lib/react-dom.js"></script><script src="../bundle.js"></script>`;
  html = html.replace('<head>', '<head><meta charset="utf-8">' + pre).replace('<html>', '<html data-theme="light">');
  const f = `${P}/components/${c}/__rc.html`; writeFileSync(f, html);
  const pg = await b.newPage({ viewport: { width: 1000, height: 800 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await pg.goto('file://' + f); await pg.waitForTimeout(500);
  const info = await pg.evaluate(() => ({ cells: document.querySelectorAll('#g > *').length, text: document.body.innerText.trim().length, warn: document.body.innerText.includes('⚠'), font: getComputedStyle(document.querySelector('#g *:not(h4)') || document.body).fontFamily }));
  await pg.screenshot({ path: `${OUT}/${c}.png`, fullPage: false });
  res.push({ c, ...info, errs: errs.filter(e => !/net::ERR_FILE_NOT_FOUND|favicon/.test(e)).slice(0, 2) });
  await pg.close();
}
await b.close();
for (const r of res) console.log(`${r.cells > 0 && r.text > 0 && !r.warn && !r.errs.length ? 'OK ' : 'BAD'} ${r.c} cells=${r.cells} text=${r.text} font=${r.font.slice(0,30)} ${r.errs.join(' | ').slice(0,200)}`);
