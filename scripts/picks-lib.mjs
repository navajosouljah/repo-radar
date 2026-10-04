// picks-lib.mjs - two small rules candidates.mjs and build.mjs share. Pure functions, tested in
// picks-lib.test.mjs.

// 26096 -> "26.1K". The site never prints raw digits.
export const human = n => {
  if (n == null || n === '') return 'no data';
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e5 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(v);
};

// A repo can't have gained more stars in a window than it has in total. A daily pace x 7 on an
// 8-day-old repo said 11.2K on 5.3K stars (Strata, Oct 2 2026) and fed the ranking score.
export const capGain = (gain, stars) => (gain != null && stars != null && gain > stars ? stars : gain ?? null);

// What a repo gained in a window of days. Younger than the window: every star it has, exactly,
// whatever an outside estimate says (a 5-day-old repo with 5.5K stars did not gain 1.3K "this
// week"). Otherwise the measured or estimated gain, never more than the total.
export const windowGain = (gain, stars, ageDays, windowDays) => (stars != null && ageDays != null && ageDays <= windowDays ? stars : capGain(gain, stars));

// What a Top 10 card shows in place of total stars: why this repo is here this week (JJ, Oct 3
// 2026: total stars say nothing about the week). `p` is the pick from edition.json, `c` is the same
// repo in data/candidates/<date>.json. Every number is one the candidates run measured; with none,
// the card falls back to total stars.
export function whyThisWeek(p, c) {
  const DOT = '\u00a0· '; // the dot stays on the first line when the label wraps
  const total = `${human(p.stars)} stars`;
  const s = c?.signals || {};
  const gain = k => { const g = capGain(s[k], p.stars ?? s.stars); return g > 0 ? g : null; };
  if (c?.age_days != null && c.age_days < 45) return `${c.age_days < 1 ? 'new today' : `${c.age_days} day${c.age_days === 1 ? '' : 's'} old`}${DOT}${total}`;
  if (p.slot === 'climbing' && gain('gain30')) return `Still climbing${DOT}+${human(gain('gain30'))} stars this month`;
  if (gain('gain7')) return `${/x 7|capped/.test(s.gain7_source || '') ? 'about ' : ''}+${human(gain('gain7'))} stars this week`;
  if (gain('gain30')) return `+${human(gain('gain30'))} stars this month`;
  if (gain('gain1')) return `+${human(gain('gain1'))} stars in a day`;
  return total;
}
