import {
  DEFAULT_SETTINGS,
  DEFAULT_BLOCKED,
  DEFAULT_DESTINATIONS,
  SHIPPED_IN_1_0,
  GUARD_SOMETIMES,
} from './defaults.js';
import {
  getSettings,
  getState,
  setState,
  prunePasses,
  todayKey,
  isWeekend,
  nextLocalMidnight,
  originPatternFor,
  regexFilterFor,
  clamp01,
} from './storage.js';

const TICK_ALARM = 'detour-tick';
const WEEKEND_ALARM = 'detour-weekend';
const REDIRECT_PAGE = '/pages/redirect.html';

// ---------------------------------------------------------------- rule engine

/**
 * Rebuilds the whole dynamic rule set from settings + ephemeral state.
 * One rule per active blocked domain; ids are reassigned each time, so the
 * previous set is always fully replaced (no drift, no stale rules).
 *
 * Serialized: several events (a storage write plus an explicit message, say)
 * routinely fire at once, and two rebuilds interleaving would each remove the
 * id set they read at the start — leaving the other's extra rules orphaned.
 */
let rebuildQueue = Promise.resolve();

function rebuildRules(options) {
  rebuildQueue = rebuildQueue.catch(() => {}).then(() => applyRules(options));
  return rebuildQueue;
}

async function applyRules({ sweep = false } = {}) {
  const settings = await getSettings();
  const state = await getState();
  const now = Date.now();

  const { passes, changed } = prunePasses(state.passes, now);
  if (changed) await setState({ passes });

  const paused = state.pausedUntil > now;
  const weekendOff = settings.offOnWeekends && isWeekend();
  const active = settings.enabled && !paused && !weekendOff;

  // Only domains we actually hold host permission for can be redirected;
  // a rule without permission silently never fires, so skip it and let the
  // options page surface the missing grant.
  const granted = await chrome.permissions.getAll();
  const grantedOrigins = new Set(granted.origins || []);
  const hasAllUrls = grantedOrigins.has('*://*/*') || grantedOrigins.has('<all_urls>');

  const redirectUrl = chrome.runtime.getURL(REDIRECT_PAGE);
  const rules = [];
  // The same guards expressed without regex, in case Chrome won't index the
  // regex form. Losing the deep link is a scratch; losing the guard is not.
  const plain = [];
  const sweepDomains = [];

  if (active) {
    for (const entry of settings.blocked) {
      if (!entry.enabled) continue;
      if (passes[entry.domain] > now) continue;
      if (!hasAllUrls && !grantedOrigins.has(originPatternFor(entry.domain))) continue;

      const id = rules.length + 1;
      const from = encodeURIComponent(entry.domain);

      plain.push({
        id,
        priority: 1,
        action: {
          type: 'redirect',
          redirect: { extensionPath: `${REDIRECT_PAGE}?from=${from}` },
        },
        condition: {
          requestDomains: [entry.domain], // also covers subdomains
          resourceTypes: ['main_frame'],
        },
      });

      // Park the whole original URL in the fragment so "Let me through" (and a
      // won sometimes-roll) can land on the page you clicked, not the homepage.
      // Group 1 is the URL; the fragment keeps its own `?a=b&c=d` out of ours.
      rules.push({
        id,
        priority: 1,
        action: {
          type: 'redirect',
          redirect: { regexSubstitution: `${redirectUrl}?from=${from}#\\1` },
        },
        condition: {
          regexFilter: regexFilterFor(entry.domain),
          resourceTypes: ['main_frame'],
        },
      });
      if (entry.guard !== GUARD_SOMETIMES) sweepDomains.push(entry.domain);
    }
  }

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);
  let error = null;

  // updateDynamicRules is all-or-nothing: one rule Chrome dislikes and every
  // other guard fails to apply with it, silently. Fall back to the plain rules
  // so the list keeps working, and leave the reason where settings can show it.
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: rules });
  } catch (first) {
    error = String(first?.message || first);
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: plain });
    } catch (second) {
      error = String(second?.message || second);
    }
  }
  await noteRuleHealth(state, { error, count: rules.length });

  await updateBadge({
    active,
    paused,
    weekendOff,
    enabled: settings.enabled,
    count: rules.length,
  });
  await scheduleTick({ passes, pausedUntil: state.pausedUntil });
  await scheduleWeekendAlarm(settings.offOnWeekends);

  // Rules only catch new navigations, so a tab that was already sitting on a
  // guarded site would survive untouched. Sweep those when a guard is switched
  // on — but never on the background tick, which would yank a tab out from
  // under someone mid-sentence when a pass quietly expires. "Sometimes" sites
  // are left alone too: the point there is to interrupt the reflex of opening
  // the site, not the article you are already halfway through.
  if (sweep && active) await sweepOpenTabs(sweepDomains);
}

/** Records how the last rebuild went, but only when it differs — this runs on
 *  every tick and a needless write would wake the options page for nothing. */
async function noteRuleHealth(state, { error, count }) {
  if (state.lastRuleError === error && state.ruleCount === count) return;
  await setState({ lastRuleError: error, ruleCount: count });
}

async function sweepOpenTabs(domains) {
  for (const domain of domains) {
    let tabs = [];
    try {
      tabs = await chrome.tabs.query({ url: [`*://*.${domain}/*`] });
    } catch {
      continue; // no host permission for this one
    }
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      const from = encodeURIComponent(domain);
      const hash = tab.url ? `#${tab.url}` : '';
      chrome.tabs
        .update(tab.id, {
          url: chrome.runtime.getURL(`${REDIRECT_PAGE}?from=${from}${hash}`),
        })
        .catch(() => {});
    }
  }
}

async function updateBadge({ active, paused, weekendOff, enabled, count }) {
  let text = '';
  let color = '#1f6feb';
  if (!enabled) {
    text = 'off';
    color = '#6b7280';
  } else if (weekendOff) {
    text = 'wk';
    color = '#6b7280';
  } else if (paused) {
    text = 'zZ';
    color = '#b45309';
  } else if (active && count === 0) {
    text = '!';
    color = '#b45309'; // on, but nothing is actually being guarded
  }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

/** Keeps a 1-minute tick alive only while a pass or pause is pending. */
async function scheduleTick({ passes, pausedUntil }) {
  const pending =
    (pausedUntil || 0) > Date.now() || Object.values(passes).some((t) => t > Date.now());
  if (pending) {
    const alarm = await chrome.alarms.get(TICK_ALARM);
    if (!alarm) chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  } else {
    await chrome.alarms.clear(TICK_ALARM);
  }
}

/** Fires at the next local midnight so Sat/Sun off turns on and off without a wake. */
async function scheduleWeekendAlarm(offOnWeekends) {
  if (!offOnWeekends) {
    await chrome.alarms.clear(WEEKEND_ALARM);
    return;
  }
  chrome.alarms.create(WEEKEND_ALARM, { when: nextLocalMidnight() });
}

// ------------------------------------------------------------- sometimes mode

/**
 * Decides whether this visit to a "sometimes" site goes through.
 *
 * Two ways to win: you have not reached for the site in a while (the first
 * visit of the morning shouldn't be a fight), or the dice say so. A win opens
 * the site for a few minutes rather than for one page load — otherwise every
 * click inside the site would be a fresh coin flip.
 *
 * Lives here rather than on the redirect page so the roll, the timestamp and
 * the pass are written in one place, and the caller can navigate as soon as it
 * resolves knowing the rule is already lifted.
 */
async function decideVisit(domain) {
  const settings = await getSettings();
  const entry = settings.blocked.find((b) => b.domain === domain);
  if (!entry || entry.guard !== GUARD_SOMETIMES) return { allow: false, reason: 'always' };

  const state = await getState();
  const now = Date.now();
  const restMs = (Number(entry.restMinutes) || 0) * 60_000;
  const last = state.visits[domain] || 0;
  // Never been here, or been away long enough — through you go.
  const rested = restMs > 0 && now - last >= restMs;
  const allow = rested || Math.random() >= clamp01(entry.chance);

  // Stamped on every attempt, won or lost: "last time you reached for it".
  await setState({ visits: { ...state.visits, [domain]: now } });

  if (!allow) return { allow: false, reason: 'chance' };

  const minutes = Number(entry.sessionMinutes) || 20;
  const until = now + minutes * 60_000;
  const stats = { total: 0, allowed: 0, byDomain: {}, days: {}, ...state.stats };
  stats.allowed = (stats.allowed || 0) + 1;
  await setState({ passes: { ...state.passes, [domain]: until }, stats });
  await rebuildRules();

  return { allow: true, reason: rested ? 'rested' : 'chance', until };
}

// ------------------------------------------------------------------- counters

async function recordRedirect(domain) {
  const state = await getState();
  const stats = { total: 0, allowed: 0, byDomain: {}, days: {}, ...state.stats };
  const day = todayKey();
  stats.total = (stats.total || 0) + 1;
  stats.byDomain[domain] = (stats.byDomain[domain] || 0) + 1;
  stats.days[day] = (stats.days[day] || 0) + 1;

  // Keep the daily log bounded to the last 30 days.
  const days = Object.keys(stats.days).sort();
  while (days.length > 30) delete stats.days[days.shift()];

  await setState({ stats });
  return stats;
}

// ------------------------------------------------------------------- lifecycle

/**
 * Brings a profile up to date with what this version ships.
 *
 * Your lists live in sync storage and win outright over the shipped defaults,
 * so before this existed an update could add a site or a whole destination pool
 * and nobody who already had Detour installed would ever see it. Everything we
 * have offered is recorded in `seeded`, so a site you deleted on purpose stays
 * deleted while genuinely new ones arrive.
 */
let seedOnce = null;

function seedDefaults() {
  seedOnce ||= applySeed(); // once per worker lifetime, whoever asks first
  return seedOnce;
}

async function applySeed() {
  const stored = await chrome.storage.sync.get([...Object.keys(DEFAULT_SETTINGS), 'seeded']);
  const patch = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (stored[key] === undefined) patch[key] = value;
  }

  const blocked = stored.blocked ?? DEFAULT_BLOCKED;
  const destinations = stored.destinations ?? DEFAULT_DESTINATIONS;
  const everything = {
    blocked: DEFAULT_BLOCKED.map((b) => b.domain),
    destinations: DEFAULT_DESTINATIONS.map((d) => d.url),
  };

  // A fresh profile has seen everything by definition. A profile from before
  // the ledger existed is credited with exactly what that version shipped.
  const firstRun = stored.blocked === undefined && stored.destinations === undefined;
  const seeded = stored.seeded ?? (firstRun ? everything : SHIPPED_IN_1_0);

  const newBlocked = DEFAULT_BLOCKED.filter(
    (b) => !seeded.blocked.includes(b.domain) && !blocked.some((x) => x.domain === b.domain),
  );
  const newDestinations = DEFAULT_DESTINATIONS.filter(
    (d) => !seeded.destinations.includes(d.url) && !destinations.some((x) => x.url === d.url),
  );

  if (newBlocked.length) patch.blocked = [...blocked, ...newBlocked];
  if (newDestinations.length) patch.destinations = [...destinations, ...newDestinations];

  const ledger = {
    blocked: [...new Set([...seeded.blocked, ...everything.blocked])],
    destinations: [...new Set([...seeded.destinations, ...everything.destinations])],
  };

  // This also runs on every worker wake, so say nothing when there is nothing
  // to say — sync writes are rate-limited and this one would be pure noise.
  const settled =
    !Object.keys(patch).length && JSON.stringify(stored.seeded) === JSON.stringify(ledger);
  if (settled) return;

  patch.seeded = ledger;
  await chrome.storage.sync.set(patch);
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install' || details.reason === 'update') await seedDefaults();
  await rebuildRules();
});

chrome.runtime.onStartup.addListener(rebuildRules);

chrome.storage.onChanged.addListener((changes, area) => {
  const watched =
    area === 'sync' ? ['enabled', 'blocked', 'offOnWeekends'] : ['passes', 'pausedUntil'];
  if (watched.some((key) => key in changes)) {
    // A settings edit is a deliberate act; a pass expiring is not.
    rebuildRules({ sweep: area === 'sync' });
  }
});

chrome.permissions.onAdded.addListener(() => rebuildRules({ sweep: true }));
chrome.permissions.onRemoved.addListener(() => rebuildRules());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM || alarm.name === WEEKEND_ALARM) rebuildRules();
});

// -------------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'decideVisit': {
        sendResponse(await decideVisit(message.domain));
        break;
      }
      case 'grantPass': {
        const minutes = Number(message.minutes) || 5;
        const state = await getState();
        const passes = { ...state.passes, [message.domain]: Date.now() + minutes * 60_000 };
        await setState({ passes });
        await rebuildRules();
        sendResponse({ ok: true, until: passes[message.domain] });
        break;
      }
      case 'pause': {
        const minutes = Number(message.minutes) || 15;
        await setState({ pausedUntil: Date.now() + minutes * 60_000 });
        await rebuildRules();
        sendResponse({ ok: true });
        break;
      }
      case 'resume': {
        await setState({ pausedUntil: 0, passes: {} });
        await rebuildRules({ sweep: true });
        sendResponse({ ok: true });
        break;
      }
      case 'recordRedirect': {
        const stats = await recordRedirect(message.domain);
        sendResponse({ ok: true, stats });
        break;
      }
      case 'rebuild': {
        await rebuildRules();
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: 'unknown message' });
    }
  })();
  return true; // async response
});

// The worker can be revived without any of the events above firing (e.g. after
// an update, or when onInstalled was missed entirely because the extension was
// reloaded in place); make sure the profile is current and the rules match it.
seedDefaults().then(() => rebuildRules());
