// Shipped defaults. Anything the user edits lives in chrome.storage.sync and
// wins over these; `resetSettings()` in storage.js puts these back.

// How hard a site is guarded.
//   always    — every visit is redirected (the original behaviour)
//   sometimes — a visit is redirected `chance` of the time, so the site stays
//               reachable but stops being a reflex
export const GUARD_ALWAYS = 'always';
export const GUARD_SOMETIMES = 'sometimes';

/**
 * Per-entry defaults. `normalizeSettings()` folds these into every stored entry
 * on read, so lists saved before "sometimes" existed keep behaving exactly as
 * they did — always on, creative destinations.
 */
export const BLOCKED_DEFAULTS = {
  enabled: true,
  guard: GUARD_ALWAYS,
  // sometimes only ---------------------------------------------------------
  chance: 0.6, // how often a visit gets detoured
  restMinutes: 180, // away this long and the next visit is free, no dice roll
  sessionMinutes: 20, // how long a won visit stays open before rolling again
  // ------------------------------------------------------------------------
  group: 'creative', // which pool of destinations this site detours into
};

export const DESTINATION_DEFAULTS = {
  enabled: true,
  group: 'creative',
};

export const DEFAULT_BLOCKED = [
  { domain: 'x.com' },
  { domain: 'twitter.com' },
  { domain: 'instagram.com' },
  { domain: 'facebook.com' },
  { domain: 'reddit.com' },
  { domain: 'tiktok.com' },
  { domain: 'linkedin.com', enabled: false },
  { domain: 'youtube.com', enabled: false },
  { domain: 'news.ycombinator.com', enabled: false },
  // Not a time sink you want gone — just one you reach for too often, and
  // always the same one. Six visits in ten land on a different newsroom.
  { domain: 'g1.globo.com', guard: GUARD_SOMETIMES, group: 'news' },
];

export const DEFAULT_DESTINATIONS = [
  { name: 'Cosmos', url: 'https://www.cosmos.so' },
  { name: 'Curater', url: 'https://curater.org/feed' },
  { name: 'Savee', url: 'https://savee.com' },
  { name: 'Are.na', url: 'https://www.are.na' },
  { name: 'Designspiration', url: 'https://www.designspiration.com' },
  { name: 'SiteInspire', url: 'https://www.siteinspire.com' },
  { name: 'Godly', url: 'https://godly.website' },
  { name: 'Land-book', url: 'https://land-book.com' },
  { name: 'Awwwards', url: 'https://www.awwwards.com/websites/' },
  { name: 'Fonts In Use', url: 'https://fontsinuse.com' },
  { name: 'Typewolf', url: 'https://www.typewolf.com' },
  { name: "It's Nice That", url: 'https://www.itsnicethat.com' },
  { name: 'Public Work', url: 'https://public.work' },
  { name: 'The Public Domain Review', url: 'https://publicdomainreview.org' },
  { name: 'Dribbble', url: 'https://dribbble.com', enabled: false },
  { name: 'Behance', url: 'https://www.behance.net', enabled: false },

  // news — where a "sometimes" news habit gets sent instead
  { name: 'Folha de S.Paulo', url: 'https://www.folha.uol.com.br', group: 'news' },
  { name: 'Estadão', url: 'https://www.estadao.com.br', group: 'news' },
  { name: 'O Tempo', url: 'https://www.otempo.com.br', group: 'news' },
  { name: 'Revista piauí', url: 'https://piaui.folha.uol.com.br', group: 'news' },
  { name: 'Nexo Jornal', url: 'https://www.nexojornal.com.br', group: 'news' },
  { name: 'BBC News Brasil', url: 'https://www.bbc.com/portuguese', group: 'news' },
  { name: 'The Verge', url: 'https://www.theverge.com', group: 'news' },
  { name: 'The New York Times', url: 'https://www.nytimes.com', group: 'news' },
  { name: 'The Guardian', url: 'https://www.theguardian.com/international', group: 'news' },
  { name: 'Reuters', url: 'https://www.reuters.com', group: 'news', enabled: false },
];

/**
 * What version 1.0.0 shipped, kept verbatim as history.
 *
 * Settings live in sync storage and win over the lists above, so a profile
 * saved by an older version would never see anything added since. `seedDefaults()`
 * uses this to tell "you deleted reddit.com" apart from "reddit.com didn't exist
 * yet when you last saved" — only the second kind gets added on an update.
 * Profiles from 1.1.0 onwards carry their own ledger and never consult this.
 */
export const SHIPPED_IN_1_0 = {
  blocked: [
    'x.com',
    'twitter.com',
    'instagram.com',
    'facebook.com',
    'reddit.com',
    'tiktok.com',
    'linkedin.com',
    'youtube.com',
    'news.ycombinator.com',
  ],
  destinations: [
    'https://www.cosmos.so',
    'https://curater.org/feed',
    'https://savee.com',
    'https://www.are.na',
    'https://www.designspiration.com',
    'https://www.siteinspire.com',
    'https://godly.website',
    'https://land-book.com',
    'https://www.awwwards.com/websites/',
    'https://fontsinuse.com',
    'https://www.typewolf.com',
    'https://www.itsnicethat.com',
    'https://public.work',
    'https://publicdomainreview.org',
    'https://dribbble.com',
    'https://www.behance.net',
  ],
};

export const DEFAULT_SETTINGS = {
  enabled: true,
  // When on, Detour stays out of the way on Saturdays and Sundays.
  offOnWeekends: true,
  // 'interstitial' shows a short card before bouncing; 'instant' jumps straight there.
  mode: 'interstitial',
  interstitialMs: 1400,
  // 'random' picks any enabled destination; 'rotate' walks the list in order.
  pickMode: 'random',
  rotateIndex: 0,
  // Minutes granted by "let me through anyway".
  passMinutes: 5,
  blocked: DEFAULT_BLOCKED,
  destinations: DEFAULT_DESTINATIONS,
};
