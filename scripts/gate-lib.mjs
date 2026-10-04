// gate-lib.mjs - the security gate's pure decision rules, shared by gate.mjs, gate-recheck.mjs and
// the public-page reader. Tested in gate-lib.test.mjs. Change a rule here, add a test for it there.

export const ver = s => { const m = String(s || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/); return m ? [+m[1], +m[2], +(m[3] || 0)] : null; };
export const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
export const maxVer = list => list.map(ver).filter(Boolean).sort(cmp).pop() || null;

// Does an advisory or CVE record belong to this repo? Structured source first; otherwise the
// record's own words or links must name the project. (Sep 27 2026: an unreviewed record with no
// package was once dismissed wholesale, which wrongly cleared two CVEs that named their repo.)
// A record that links only a sibling repo of the same owner is about the sibling (Sep 27 2026:
// firecrawl-mcp-server's CVE-2026-85606 was pinned on firecrawl/firecrawl by a prefix match).
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function tiedToRepo(adv, o, r) {
  const want = `${o}/${r}`.toLowerCase();
  const src = String(adv.source_code_location || '').toLowerCase();
  if (src) return src.replace(/\/+$/, '').replace(/\.git$/, '').endsWith(`github.com/${want}`);
  const refs = (adv.references || []).map(x => (typeof x === 'string' ? x : x?.url || '')).join(' ');
  const text = `${adv.description || ''} ${adv.summary || ''} ${refs}`.toLowerCase();
  const linked = [...text.matchAll(/github\.com\/([\w.-]+)\/([\w.-]+)/g)].map(m => `${m[1]}/${m[2].replace(/\.git$/, '')}`);
  if (linked.includes(want)) return true;
  if (linked.some(l => l.startsWith(`${o.toLowerCase()}/`))) return false;
  const name = esc(r.toLowerCase()).replace(/[-_]/g, '[-_ ]?');
  return text.includes(o.toLowerCase()) && new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(text);
}

// A CVE published before the repo existed can't be about it: a 2007 CVE for some other "Dagger"
// turned up in the CVE-database search for dagger/dagger (created 2019) on Sep 27 2026.
export const predates = (published, created) => !!(published && created && String(published).slice(0, 10) < String(created).slice(0, 10));

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

// Status of one advisory read from GitHub's public pages (the cloud has no API). Same rules as
// gate.mjs plus gate-recheck.mjs: a fix is a patched version, a strict "< X" range, or a version in
// the text, and it counts only once a published version (GitHub release or the named registry) has
// reached it. A fix given only as a commit or pull request can't be traced to a release from public
// pages, so it is "fix-unverified": the gate makes that a REVIEW, never a PASS and never a blocklist.
export function advisoryStatus({ packages = [], description = '', references = [] }, latest, o, r) {
  const patched = packages.map(p => p.patched).filter(Boolean);
  const open = packages.filter(p => !p.patched).map(p => p.name || '?');
  let fix = maxVer(patched.flatMap(p => p.split(',')));
  if (!patched.length) fix = fixFromRanges(packages.map(p => ({ vulnerable_version_range: p.affected || '' }))) || fixFromText(description);
  if (!fix) return { status: commitsFromText(description).length || prsFromRefs(references, o, r).length ? 'fix-unverified' : 'unpatched', fix: null, open };
  if (patched.length && open.length) return { status: 'partly-patched', fix, open };
  if (!latest) return { status: 'patch-unconfirmed', fix, open };
  return { status: cmp(latest, fix) >= 0 ? 'patched' : 'fix-unreleased', fix, open };
}

// Stars versus real activity. Numbers a star farm can't fake cheaply: contributors, commits,
// watchers, open issues. ageDays may be unknown (null); that check is then skipped.
export function activityFlags(a, o, r) {
  const flags = [];
  if (a.canonical && a.canonical.toLowerCase() !== `${o}/${r}`.toLowerCase()) flags.push(`renamed/moved to ${a.canonical}`);
  if (a.stars >= 5000 && a.contributors != null && a.contributors <= 2) flags.push(`${a.stars} stars on ${a.contributors} contributor(s)`);
  if (a.stars >= 5000 && a.commits != null && a.commits < 30) flags.push(`${a.stars} stars on only ${a.commits} commit(s)`);
  if (a.stars >= 10000 && a.watchers != null && a.watchers / a.stars < 0.001) flags.push(`very few watchers for the stars (${a.watchers})`);
  if (a.stars >= 10000 && a.hasIssues && a.openIssues === 0 && a.ageDays != null && a.ageDays > 30) flags.push('no open issues or PRs despite the stars');
  if (a.archived) flags.push('archived');
  return flags;
}

// A human ruling ("settled") covers the evidence it was made on. When a repo is gated again, the
// ruling carries over only if nothing new turned up: every advisory, CVE, report and activity flag
// behind the new automatic verdict was already in the entry the human ruled on, and every check
// actually ran. Advisories are matched by ID, so a status that reads differently from the public
// pages than it did from the API (a Docker-image fix, a commit fix) doesn't undo the ruling. New
// evidence of any kind returns the decision to a human.
const flagKey = f => `flag ${String(f).replace(/[\d,.]+/g, '#')}`;
export function seenBy(entry) {
  const c = entry?.checks || {};
  const s = new Set();
  for (const i of c.advisories?.items || []) s.add(`advisory ${i.ghsa}`);
  for (const x of [...(c.searches?.cves || []), ...(entry?.recheck?.items || [])]) for (const id of [x.id, x.ghsa, x.cve]) if (id) s.add(`advisory ${id}`);
  for (const h of c.searches?.hits || []) s.add(`report ${h.url}`);
  for (const f of c.activity?.flags || []) s.add(flagKey(f));
  return s;
}
export function newConcerns(old, fresh) {
  const c = fresh?.checks || {};
  const seen = seenBy(old);
  const out = [];
  if (c.advisories?.error) out.push(`advisories not checked: ${c.advisories.error}`);
  if (c.activity?.error) out.push(`activity not checked: ${c.activity.error}`);
  if (c.searches && c.searches.errors === c.searches.queries?.length) out.push('searches not run: all failed');
  if (c.searches?.nvd?.error) out.push(`CVE database not searched: ${c.searches.nvd.error}`);
  for (const i of c.advisories?.items || []) if (i.status !== 'patched' && !seen.has(`advisory ${i.ghsa}`)) out.push(`advisory ${i.ghsa} (${i.status})`);
  for (const x of c.searches?.cves || []) if (!['patched', 'other-project'].includes(x.status) && ![x.id, x.ghsa].some(id => id && seen.has(`advisory ${id}`))) out.push(`CVE ${x.id} (${x.status})`);
  for (const h of c.searches?.hits || []) if (h.kind === 'report' && !seen.has(`report ${h.url}`)) out.push(`report ${h.url}`);
  for (const f of c.activity?.flags || []) if (!seen.has(flagKey(f))) out.push(`activity: ${f}`);
  return out;
}

// A verdict the cloud run can't be trusted to get right on its own. It reads advisories from
// GitHub's public pages, and some of those pages don't show the fixed version, so a patched repo
// looks unpatched (ai-memory, Oct 2 2026: failed with both advisories already fixed in a release;
// the API gate on the Mac passed it the next day). It errs on the safe side, so the repo still comes
// down; the Friday report must list it for a re-check from the Mac (JJ, Oct 3 2026).
export const needsMacRecheck = e => !!e && e.verdict !== 'PASS' && !e.settled && e.checks?.advisories?.source === 'public-page'
  && [...(e.checks.advisories.items || []), ...(e.checks.searches?.cves || [])].some(i => i.status !== 'patched' && i.status !== 'other-project');
