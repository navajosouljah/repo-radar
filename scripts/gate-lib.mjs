// gate-lib.mjs - the security gate's pure decision rules, shared by gate.mjs and gate-recheck.mjs.
// Tested in gate-lib.test.mjs. Change a rule here, add a test for it there.

export const ver = s => { const m = String(s || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/); return m ? [+m[1], +m[2], +(m[3] || 0)] : null; };
export const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
export const maxVer = list => list.map(ver).filter(Boolean).sort(cmp).pop() || null;

// Does an advisory or CVE record belong to this repo? Structured source first; otherwise the
// record's own words or links must name the project. (Sep 27 2026: an unreviewed record with no
// package was once dismissed wholesale, which wrongly cleared two CVEs that named their repo.)
export function tiedToRepo(adv, o, r) {
  const want = `github.com/${o}/${r}`.toLowerCase();
  const src = String(adv.source_code_location || '').toLowerCase();
  if (src) return src.replace(/\/+$/, '').endsWith(want);
  const refs = (adv.references || []).map(x => (typeof x === 'string' ? x : x?.url || '')).join(' ');
  const text = `${adv.description || ''} ${adv.summary || ''} ${refs}`.toLowerCase();
  if (text.includes(want)) return true;
  const name = r.toLowerCase().replace(/[-_]/g, '[-_ ]?');
  return text.includes(o.toLowerCase()) && new RegExp(`\\b${name}\\b`).test(text);
}

// A fixed version stated in words: "fixed in 1.2.3", "before 1.2.3", "upgrade to 1.2.3",
// "1.2.3 is the first patched version". An affected range like "up to 1.2.3" is NOT a fix.
const FIX_TEXT = /(?:fixed|patched|resolved|addressed|remediated)\s+(?:in|with|by)\s+(?:version\s+|release\s+|v)?(\d+\.\d+(?:\.\d+)?)|upgrad\w*\s+to\s+(?:version\s+|v)?(\d+\.\d+(?:\.\d+)?)|(?:version|release)\s+v?(\d+\.\d+(?:\.\d+)?)\s+(?:contains|includes|fixes|patches|addresses)|(?:before|prior to)\s+(?:version\s+|v)?(\d+\.\d+(?:\.\d+)?)|:?v?(\d+\.\d+(?:\.\d+)?)`?\s+is the first (?:patched|fixed) version/gi;
export function fixFromText(text) {
  const found = [];
  for (const m of String(text || '').matchAll(FIX_TEXT)) found.push(m[1] || m[2] || m[3] || m[4] || m[5]);
  return maxVer(found);
}

// GitHub convention: a strict "< X" bound means X is the first fixed version; "<= X" means X is still affected.
export const fixFromRanges = vulns => maxVer((vulns || []).map(v => (String(v.vulnerable_version_range || '').match(/(?:^|,\s*)<\s*v?(\d+\.\d+(?:\.\d+)?)/) || [])[1]).filter(Boolean));

// "prior to commit 92c7a20", "fixed in commit 1518530", "patched in commit `4dc2c0a...`"
const FIX_COMMIT = /(?:prior to|before|fixed in|patched in|fixed by|addressed in)\s+commit\s+`?([0-9a-f]{7,40})`?/gi;
export const commitsFromText = text => [...new Set([...String(text || '').matchAll(FIX_COMMIT)].map(m => m[1]))];

// Fix pull requests linked from the record's references, for this repo only.
export function prsFromRefs(refs, o, r) {
  const re = new RegExp(`github\\.com/${o}/${r}/pull/(\\d+)`, 'i');
  return [...new Set((refs || []).map(x => (typeof x === 'string' ? x : x?.url || '')).map(u => (u.match(re) || [])[1]).filter(Boolean))].map(Number);
}
