# Detour

A Chrome extension that catches the sites you open out of habit — X/Twitter, Instagram,
Reddit, TikTok — and sends you somewhere worth looking at instead: Cosmos, Savee, Are.na,
SiteInspire, Fonts In Use, Public Work and friends.

## Install (unpacked)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → pick this folder
4. Pin the extension so the toolbar toggle is one click away

Then type `x.com` in the address bar. You should land on a card that strikes the site out
and bounces you to a creative destination.

## How it behaves

- **Redirect list** — x.com, twitter.com, instagram.com, facebook.com, reddit.com and
  tiktok.com are on by default. linkedin.com, youtube.com and news.ycombinator.com ship
  switched off. Subdomains are always included.
- **Always or sometimes** — every site is guarded one of two ways. *Always* is the hard
  block above. *Sometimes* rations a site you don't want gone, just visited less: g1.globo.com
  ships this way and is redirected 60% of the time. See below.
- **Destination pools** — destinations belong to a pool, and each guarded site says which
  pool it draws from, so a news habit lands on other newsrooms rather than on Are.na. The
  `creative` pool has 14 sites on by default (Cosmos, Curater, Savee, Are.na, Designspiration,
  SiteInspire, Godly, Land-book, Awwwards, Fonts In Use, Typewolf, It's Nice That, Public
  Work, The Public Domain Review) plus Dribbble and Behance switched off; the `news` pool has
  Folha, Estadão, O Tempo, piauí, Nexo, BBC Brasil, The Verge, NYT and The Guardian, plus
  Reuters switched off. Add your own pools by typing a new name when you add a destination.
- **Arrival** — by default a short card names where you're going, then bounces after 1.4s.
  Press `Esc` to hold it, hit **Somewhere else** to reroll, or switch to *Jump instantly*
  in settings to skip the card entirely.
- **Escape hatch** — **Let me through anyway** opens the site for 5 minutes (configurable
  up to an hour), then the guard comes back.
- **Pause** — the popup pauses everything for 15 minutes; the toolbar badge shows `zZ`
  while it's paused and `off` when the extension is switched off.
- **Already-open tabs** — turning a guard on also redirects tabs already sitting on that
  site. A pass quietly expiring does not, so you never lose what you were typing.
  "Sometimes" sites are never swept: the point is to interrupt the reflex of opening the
  site, not the article you're halfway through.

## Sites you visit too often, not too much

Some sites don't deserve a ban — you just reach for the same one every time. Set a site to
**Sometimes** (click it in settings to open its dials) and every visit is a roll of the dice:

- **Redirect me** — how often a visit gets bounced. `60%` for g1.globo.com, so four visits in
  ten go through untouched.
- **Free pass after a break of** — come back rested and the first visit is never redirected.
  Three hours by default, so checking the news in the morning is never a fight; opening it
  again ten minutes later probably is.
- **A visit stays open for** — a won visit opens the site for 20 minutes, so reading three
  articles is one roll of the dice rather than three.

A won roll keeps the address you actually typed or clicked, deep link and all — the rules for
these sites carry the original URL through the redirect page, so a shared article still opens
on that article.

## Adding your own sites

Chrome only lets an extension redirect hosts you've explicitly allowed. The ten defaults
are granted at install; anything you add prompts once for access. If a row in settings
shows a **needs access** pill, the rule is inert until you press **Grant**.

## Layout

```
manifest.json          MV3 manifest — permissions, background worker, pages
src/defaults.js        shipped site + destination lists and default behaviour
src/storage.js         storage accessors and domain/URL helpers
src/background.js      service worker: builds the declarativeNetRequest rules
pages/redirect.html    the interstitial you land on (+ .css / .js)
pages/popup.html       toolbar popup: master switch, per-site toggles, pause
pages/options.html     full settings: lists, behaviour, tally
icons/                 generated PNG icons
```

Redirects are done with **declarativeNetRequest** dynamic rules rather than by watching
navigation from the service worker, so the guarded site never gets to load — there's no
flash of the timeline before the bounce.

Settings live in `chrome.storage.sync` (they follow your profile). Passes, the pause timer,
the last time you reached for each site and the tally live in `chrome.storage.local`.

"Sometimes" sites are the one case where the page does load: the rule sends every visit to
the interstitial, which asks the worker for a verdict before it draws anything. A won roll
never becomes visible — the card is held back until the decision is in.
