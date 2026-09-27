// shots.mjs - find real pictures of a product for its page: the images and demo videos in its
// README, and its website's preview image. Never GitHub's auto-generated repo card, badges, logos or
// avatars. Each image is downloaded to /tmp so it can be LOOKED AT before it is chosen (the alt text
// must describe what is really in it), and the script prints what it found and how to use it.
// It writes nothing into the site.
//
// Usage: node scripts/shots.mjs owner/repo [--site https://the-website]
import { mkdirSync, writeFileSync } from 'node:fs';
import { fetchPage } from './public-pages.mjs';

const argv = process.argv.slice(2);
const repo = argv.find(a => /^[\w.-]+\/[\w.-]+$/.test(a));
const site = argv.includes('--site') ? argv[argv.indexOf('--site') + 1] : null;
if (!repo) { console.error('usage: node scripts/shots.mjs owner/repo [--site https://...]'); process.exit(1); }
const [o, r] = repo.split('/');
const OUT = `/tmp/repo-radar-shots/${o}--${r}`;
mkdirSync(OUT, { recursive: true });

const NOT_A_SHOT = /shields\.io|badgen|badge|\/workflows\/|star-history|trendshift\.io\/api|contrib\.rocks|avatars\.githubusercontent|opengraph\.githubassets|githubassets\.com\/(images|assets)|sponsor|buymeacoffee|ko-fi|discord|twitter|x\.com\/|producthunt|readme-typing|visitor|hits\.|komarev|wakatime|codecov|coveralls|deepwiki|capsule-render|skillicons|devicons|simpleicons|logo|icon|emoji/i;
const unjson = s => s.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&').replace(/\\"/g, '"').replace(/\\\//g, '/');
const amp = s => s.replace(/&amp;/g, '&');
// An image uploaded to an issue or README is shown through a link that expires in minutes; the
// lasting address is github.com/user-attachments/assets/<id>, which is what a page must use.
const lasting = u => { const m = u.match(/private-user-images\.githubusercontent\.com\/\d+\/\d+-([0-9a-f-]{36})\.\w+/); return m ? `https://github.com/user-attachments/assets/${m[1]}` : u; };

// Width and height from the file's own header bytes (PNG, GIF, JPEG, WebP).
function dims(b) {
  const u32be = i => b.readUInt32BE(i), u16le = i => b.readUInt16LE(i);
  if (b.length > 24 && b.toString('ascii', 1, 4) === 'PNG') return { type: 'png', w: u32be(16), h: u32be(20) };
  if (b.length > 10 && b.toString('ascii', 0, 3) === 'GIF') return { type: 'gif', w: u16le(6), h: u16le(8) };
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { type: 'webp', w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (chunk === 'VP8L') { const bits = b.readUInt32LE(21); return { type: 'webp', w: 1 + (bits & 0x3fff), h: 1 + ((bits >> 14) & 0x3fff) }; }
    return { type: 'webp', w: u16le(26) & 0x3fff, h: u16le(28) & 0x3fff };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i < b.length - 9;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { type: 'jpg', w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
    return { type: 'jpg', w: null, h: null };
  }
  return null;
}

// 1. The README as GitHub renders it (it rides inside the repo page's data).
const found = [];
const page = await fetchPage(`https://github.com/${o}/${r}`);
if (page.error) { console.error(`could not read the repo page: ${page.error}`); process.exit(2); }
const readme = unjson(page.text);
for (const m of readme.matchAll(/<img[^>]*>/g)) {
  const tag = m[0];
  const src = amp((tag.match(/data-canonical-src="([^"]+)"/) || tag.match(/\ssrc="([^"]+)"/) || [])[1] || '');
  const shown = amp((tag.match(/\ssrc="([^"]+)"/) || [])[1] || src);
  if (!src || NOT_A_SHOT.test(src) || /\.svg(\?|$)/i.test(src)) continue;
  if (!found.some(f => f.shown === shown)) found.push({ from: 'README image', src, shown: shown.startsWith('/') ? `https://github.com${shown}` : shown });
}
// Diagrams drawn as SVG in the README, hosted by the repo itself. They can't be measured like a
// photo, so they are listed separately: a still one can be used by its link; an animated one loops
// forever with no pause button, so use it only as a still frame (render it on a Mac).
const diagrams = [];
for (const m of readme.matchAll(/<img[^>]*>/g)) {
  const src = amp((m[0].match(/\ssrc="([^"]+)"/) || [])[1] || '');
  if (!/\.svg(\?|$)/i.test(src) || NOT_A_SHOT.test(src)) continue;
  const url = src.startsWith('/') ? `https://github.com${src}` : src;
  if (!new RegExp(`github\\.com/${o}/${r}/|githubusercontent\\.com/${o}/${r}/`, 'i').test(url) || diagrams.some(d => d.url === url)) continue;
  diagrams.push({ url, alt: amp((m[0].match(/alt="([^"]*)"/) || [])[1] || '') });
}
const videos = [...new Set([...readme.matchAll(/<(?:video|source)[^>]*\ssrc="([^"]+)"/g)].map(m => amp(m[1])).concat([...readme.matchAll(/https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]{36}/g)].map(m => m[0])))];

// 2. The website's own preview image.
let siteNote = '';
if (site) {
  const s = await fetchPage(site);
  const og = (s.text || '').match(/<meta[^>]+(?:property|name)="(?:og:image|twitter:image)"[^>]+content="([^"]+)"/i) || (s.text || '').match(/<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="(?:og:image|twitter:image)"/i);
  if (og) { const u = new URL(amp(og[1]), site).href; found.unshift({ from: 'website preview image', src: u, shown: u }); } // first, so a long README can't crowd it out
  else siteNote = s.error ? `website not read (${s.error})` : 'the website has no preview image';
}

// 3. Download each (first 8) to look at, and measure it.
const rows = [];
for (const [i, f] of found.slice(0, 8).entries()) {
  const res = await fetch(f.shown, { headers: { 'User-Agent': 'Mozilla/5.0 (repo-radar shots)' }, redirect: 'follow', signal: AbortSignal.timeout(60000) }).catch(e => ({ ok: false, status: String(e.message || e) }));
  if (!res.ok) { rows.push({ ...f, note: `could not download (${res.status})` }); continue; }
  const b = Buffer.from(await res.arrayBuffer());
  const d = dims(b);
  if (!d) { rows.push({ ...f, note: `not a PNG, GIF, JPEG or WebP (${res.headers.get('content-type')})` }); continue; }
  const file = `${OUT}/${i + 1}.${d.type}`;
  writeFileSync(file, b);
  const mb = b.length / 1048576;
  const usable = d.w >= 600 && d.h >= 250;
  rows.push({ ...f, file, type: d.type, width: d.w, height: d.h, mb: +mb.toFixed(2), note: !usable ? 'too small for the page' : mb > 8 ? 'too heavy to show (over 8 MB)' : mb > 2 ? 'use by link (src = the URL): too big to copy into the site' : `copy it: cp ${file} assets/shots/<slug>.${d.type}` });
}

console.log(`${repo}: ${rows.length} picture(s) found${site ? (siteNote ? ` (${siteNote})` : '') : ' (no --site given, so no website preview image)'}${videos.length ? `, ${videos.length} demo video(s)` : ''}.`);
for (const x of rows) console.log(`- ${x.from}${x.width ? `, ${x.width}x${x.height} ${x.type}, ${x.mb} MB` : ''}\n    look at it: ${x.file || '(not downloaded)'}\n    url: ${lasting(x.shown)}\n    ${x.note}`);
for (const d of diagrams.slice(0, 4)) {
  const p = await fetchPage(d.url, { tries: 2 });
  if (p.error) { console.log(`- README diagram (SVG): could not read ${d.url}`); continue; }
  const w = (p.text.match(/<svg[^>]*\swidth="([\d.]+)/) || [])[1], h = (p.text.match(/<svg[^>]*\sheight="([\d.]+)/) || [])[1];
  const moving = /<animate|@keyframes|animation\s*:/i.test(p.text);
  console.log(`- README diagram (SVG)${w && h ? `, ${Math.round(w)}x${Math.round(h)}` : ''}${d.alt ? `: "${d.alt.slice(0, 140)}"` : ''}\n    url: ${d.url}\n    ${moving ? 'animated: it loops with no pause button, so use it only as a still frame (render it on a Mac), or skip it' : 'still: can be used by link (src = the url); the alt text above is the maker\'s own description'}`);
}
for (const v of videos.slice(0, 3)) console.log(`- demo video: ${v}\n    can go in links.demo ("See it work")`);
if (!rows.some(x => x.file && !/too/.test(x.note)) && !diagrams.length) console.log('No usable picture: leave `visual` out and the page says so honestly.');
