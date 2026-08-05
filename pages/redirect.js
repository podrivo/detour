import { GUARD_SOMETIMES } from '../src/defaults.js';
import { getSettings, setSettings, hostOf, matchesDomain } from '../src/storage.js';

const params = new URLSearchParams(location.search);
const from = (params.get('from') || '').toLowerCase();

const el = {
  lead: document.getElementById('lead'),
  from: document.getElementById('from'),
  dest: document.getElementById('dest'),
  destName: document.getElementById('destName'),
  destHost: document.getElementById('destHost'),
  bar: document.getElementById('bar'),
  go: document.getElementById('go'),
  shuffle: document.getElementById('shuffle'),
  through: document.getElementById('through'),
  settings: document.getElementById('settings'),
  count: document.getElementById('count'),
  footnote: document.getElementById('footnote'),
};

let settings;
let entry = null;
let current = null;
let timer = null;

document.title = from ? `Detour — ${from}` : 'Detour';
el.from.textContent = from || 'that site';
el.through.textContent = from ? `Let me through to ${from}` : 'Let me through anyway';
el.through.hidden = !from;

/**
 * Where you were actually headed. Redirect rules park the full original URL in
 * our fragment so "Let me through" (and a won sometimes-roll) lands on the
 * page you clicked, not the site's front page. Verified against `from` before
 * we ever navigate to it.
 */
function intendedUrl() {
  const raw = location.hash.slice(1);
  if (raw) {
    try {
      const url = new URL(raw);
      if (/^https?:$/.test(url.protocol) && from && matchesDomain(hostOf(url.href), from)) {
        return url.href;
      }
    } catch {
      /* fall through to the bare domain */
    }
  }
  return from ? `https://${from}` : null;
}

/**
 * Destinations that are enabled, not themselves on the blocked list, and in the
 * pool this site detours into. A group with nothing left in it falls back to
 * everything enabled — better an off-theme landing than a dead end.
 */
function candidates() {
  const guarded = settings.blocked.filter((b) => b.enabled).map((b) => b.domain);
  const usable = settings.destinations.filter((d) => {
    if (!d.enabled) return false;
    const host = hostOf(d.url);
    if (!host) return false;
    return !guarded.some((domain) => matchesDomain(host, domain));
  });

  if (!entry) return usable;
  const grouped = usable.filter((d) => d.group === entry.group);
  return grouped.length ? grouped : usable;
}

function pick(list, avoid) {
  if (settings.pickMode === 'rotate') {
    const index = (Number(settings.rotateIndex) || 0) % list.length;
    void setSettings({ rotateIndex: (index + 1) % list.length });
    return list[index];
  }
  const pool = list.length > 1 && avoid ? list.filter((d) => d.url !== avoid.url) : list;
  return pool[Math.floor(Math.random() * pool.length)];
}

function render(dest) {
  current = dest;
  el.dest.href = dest.url;
  el.destName.textContent = dest.name || hostOf(dest.url);
  el.destHost.textContent = hostOf(dest.url);
}

function leave() {
  if (!current) return;
  clearTimeout(timer);
  location.replace(current.url);
}

function startCountdown(ms) {
  clearTimeout(timer);
  el.bar.classList.remove('running');
  el.bar.style.width = '0';
  // Force a reflow so the transition starts from 0 on every re-arm.
  void el.bar.offsetWidth;
  el.bar.style.transitionDuration = `${ms}ms`;
  el.bar.classList.add('running');
  el.bar.style.width = '100%';
  timer = setTimeout(leave, ms);
}

function cancelCountdown() {
  clearTimeout(timer);
  timer = null;
  el.bar.classList.remove('running');
  el.bar.style.width = '0';
}

function showEmptyState() {
  document.body.classList.add('empty');
  el.destName.textContent = 'Nowhere to send you';
  el.destHost.textContent = 'Turn on at least one destination in settings';
  el.go.textContent = 'Open settings';
  el.go.onclick = () => chrome.runtime.openOptionsPage();
  el.dest.removeAttribute('href');
}

async function main() {
  settings = await getSettings();
  entry = settings.blocked.find((b) => b.domain === from) || null;

  // A "sometimes" site gets a roll of the dice before anything is drawn: win it
  // and this page never becomes visible, you just continue to where you were
  // going. The background grants the pass before answering, so the rule that
  // sent us here is already gone by the time we navigate back.
  if (entry?.guard === GUARD_SOMETIMES) {
    const verdict = await chrome.runtime
      .sendMessage({ type: 'decideVisit', domain: from })
      .catch(() => null);
    if (verdict?.allow) {
      const url = intendedUrl();
      if (url) {
        location.replace(url);
        return;
      }
    }
    // Lost the roll — soften the headline; this site isn't banned, just rationed.
    el.lead.textContent = 'Not this time,';
  }

  document.body.classList.add('ready');

  const list = candidates();
  if (!list.length) {
    showEmptyState();
    return;
  }

  render(pick(list, null));

  const recorded = from
    ? chrome.runtime
        .sendMessage({ type: 'recordRedirect', domain: from })
        .then((res) => {
          const total = res?.stats?.total;
          if (total) el.count.textContent = `${total} detour${total === 1 ? '' : 's'} so far`;
        })
        .catch(() => {})
    : Promise.resolve();

  if (settings.mode === 'instant') {
    // Let the tally land before the page goes away.
    await recorded;
    leave();
    return;
  }

  // 0 means "wait for me" — no auto-bounce, the buttons are the only way out.
  const delay = Number(settings.interstitialMs);
  if (delay > 0) startCountdown(Math.max(300, delay));
}

el.go.addEventListener('click', leave);

el.shuffle.addEventListener('click', () => {
  cancelCountdown();
  const list = candidates();
  if (list.length) render(pick(list, current));
});

el.dest.addEventListener('click', (event) => {
  event.preventDefault();
  leave();
});

el.through.addEventListener('click', async () => {
  cancelCountdown();
  // Insisting on a rationed site buys the same window a won roll would have.
  const minutes =
    entry?.guard === GUARD_SOMETIMES
      ? Number(entry.sessionMinutes) || 20
      : Number(settings.passMinutes) || 5;
  // Wait for the rule to be lifted, otherwise we bounce straight back here.
  await chrome.runtime.sendMessage({ type: 'grantPass', domain: from, minutes }).catch(() => {});
  location.replace(intendedUrl() || `https://${from}`);
});

el.settings.addEventListener('click', () => chrome.runtime.openOptionsPage());

// Esc = "hold on, let me look at this" — stops the auto-bounce.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') cancelCountdown();
});

main();
