import { DEFAULT_SETTINGS, BLOCKED_DEFAULTS, DESTINATION_DEFAULTS } from './defaults.js';

// Settings live in `sync` so they follow the profile. Ephemeral state (passes,
// global pause, visit timestamps, counters) lives in `local` — it is device-
// and moment-specific.

export async function getSettings() {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...stored });
}

/**
 * Fills in per-entry defaults. Lists written by an older version are missing
 * `guard`/`group`/`chance` entirely; reading them through here means the rest
 * of the code never has to check whether a field exists.
 */
export function normalizeSettings(settings) {
  return {
    ...settings,
    blocked: (Array.isArray(settings.blocked) ? settings.blocked : []).map((entry) => ({
      ...BLOCKED_DEFAULTS,
      ...entry,
      chance: clamp01(entry.chance ?? BLOCKED_DEFAULTS.chance),
    })),
    destinations: (Array.isArray(settings.destinations) ? settings.destinations : []).map(
      (dest) => ({ ...DESTINATION_DEFAULTS, ...dest }),
    ),
  };
}

export function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export async function setSettings(patch) {
  await chrome.storage.sync.set(patch);
}

export async function resetSettings() {
  await chrome.storage.sync.clear();
  await chrome.storage.sync.set(DEFAULT_SETTINGS);
}

export async function getState() {
  const stored = await chrome.storage.local.get([
    'passes',
    'pausedUntil',
    'visits',
    'stats',
    'lastRuleError',
    'ruleCount',
  ]);
  return {
    passes: stored.passes || {}, // { [domain]: expiry epoch ms }
    pausedUntil: stored.pausedUntil || 0,
    visits: stored.visits || {}, // { [domain]: last time you reached for it }
    stats: stored.stats || { total: 0, allowed: 0, byDomain: {}, days: {} },
    lastRuleError: stored.lastRuleError || null,
    ruleCount: stored.ruleCount || 0,
  };
}

export async function setState(patch) {
  await chrome.storage.local.set(patch);
}

/** Drops expired entries; returns the live ones plus whether anything changed. */
export function prunePasses(passes, now = Date.now()) {
  const live = {};
  let changed = false;
  for (const [domain, expiry] of Object.entries(passes)) {
    if (expiry > now) live[domain] = expiry;
    else changed = true;
  }
  return { passes: live, changed };
}

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Saturday or Sunday in the user's local timezone. */
export function isWeekend(d = new Date()) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** Epoch ms of the next local midnight after `from`. */
export function nextLocalMidnight(from = new Date()) {
  const d = new Date(from);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/** "https://www.cosmos.so/x" -> "cosmos.so" (leading www. dropped). */
export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Accepts "twitter.com", "www.twitter.com/home", "https://twitter.com" -> "twitter.com". */
export function normalizeDomain(input) {
  let value = String(input || '').trim().toLowerCase();
  if (!value) return '';
  if (!/^https?:\/\//.test(value)) value = `https://${value}`;
  let host;
  try {
    host = new URL(value).hostname;
  } catch {
    return '';
  }
  host = host.replace(/^www\./, '');
  // Must look like a hostname with at least one dot and no wildcards.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return '';
  return host;
}

/** True when `host` is the domain itself or a subdomain of it. */
export function matchesDomain(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

export function originPatternFor(domain) {
  return `*://*.${domain}/*`;
}

/**
 * RE2 pattern for declarativeNetRequest that captures the *whole* URL in group
 * 1, so a rule can hand the original address to the redirect page instead of
 * losing it. Anchored on both ends and boundary-checked after the host, so
 * `g1.globo.com.example.com` is not a match.
 */
export function regexFilterFor(domain) {
  const host = domain.replace(/[.]/g, '\\.');
  return `^(https?://([a-z0-9-]+\\.)*${host}(:\\d+)?([/?#].*)?)$`;
}
