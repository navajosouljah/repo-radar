// Repo Radar v3 - the only script on the page: Copy buttons for the "Paste into Claude Code" boxes.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const text = document.getElementById(btn.dataset.copy)?.innerText || '';
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t); t.select();
    document.execCommand('copy'); t.remove();
  }
  const label = btn.textContent;
  btn.textContent = 'Copied - now paste it into Claude Code';
  setTimeout(() => { btn.textContent = label; }, 2600);
});
