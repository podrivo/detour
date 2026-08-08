import {
  DEFAULT_SETTINGS,
  BLOCKED_DEFAULTS,
  DESTINATION_DEFAULTS,
  GUARD_ALWAYS,
  GUARD_SOMETIMES,
} from '../src/defaults.js';
import {
  getSettings,
  setSettings,
  resetSettings,
  getState,
  setState,
  hostOf,
  normalizeDomain,
  originPatternFor,
  todayKey,
  isWeekend,
} from '../src/storage.js';

const $ = (id) => document.getElementById(id);

const el = {
  master: $('master'),
  blockedList: $('blockedList'),
  blockedError: $('blockedError'),
  destList: $('destList'),
  destError: $('destError'),
  groupOptions: $('groupOptions'),
  mode: $('mode'),
  delay: $('delay'),
  delayRow: $('delayRow'),
  pickMode: $('pickMode'),
  passMinutes: $('passMinutes'),
  offOnWeekends: $('offOnWeekends'),
  stats: $('stats'),
  saved: $('saved'),
  ruleStatus: $('ruleStatus'),
};

// Kept in sync by render() so click handlers can read it without an await —
// chrome.permissions.request() only works while the user gesture is still live.
let settings = { ...DEFAULT_SETTINGS };

// Which site rows have their details open, by domain. Survives the re-render
// that every save() triggers, so tweaking a dial doesn't collapse the panel.
const opened = new Set();

const CHANCE_OPTIONS = [0.25, 0.4, 0.5, 0.6, 0.75, 0.9].map((v) => ({
  value: String(v),
  label: `${Math.round(v * 100)}% of the time`,
}));

const REST_OPTIONS = [
  { value: '0', label: 'Never — always roll' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '180', label: '3 hours' },
  { value: '360', label: '6 hours' },
  { value: '720', label: '12 hours' },
  { value: '1440', label: '1 day' },
];

const SESSION_OPTIONS = [5, 10, 20, 30, 60].map((v) => ({
  value: String(v),
  label: v === 60 ? '1 hour' : `${v} minutes`,
}));

function flash(message = 'Saved') {
  el.saved.textContent = message;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => {
    el.saved.textContent = '';
  }, 1600);
}

async function save(patch, message) {
  settings = { ...settings, ...patch };
  await setSettings(patch);
  flash(message);
  render();
}

/** Writes one field of one blocked entry back, leaving the rest untouched. */
function patchBlocked(index, patch, message) {
  return save(
    { blocked: settings.blocked.map((b, i) => (i === index ? { ...b, ...patch } : b)) },
    message,
  );
}

function makeSwitch(checked, title, onChange) {
  const label = document.createElement('label');
  label.className = 'switch';
  label.title = title;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const track = document.createElement('span');
  track.className = 'track';
  label.append(input, track);
  return label;
}

function iconButton(text, title, className, onClick) {
  const button = document.createElement('button');
  button.textContent = text;
  button.title = title;
  button.className = className;
  button.addEventListener('click', onClick);
  return button;
}

/** A labelled <select> laid out like the rows in the Behaviour card. */
function selectRow(labelText, hint, options, value, onChange) {
  const row = document.createElement('div');
  row.className = 'row';

  const label = document.createElement('label');
  label.className = 'name grow';
  label.textContent = labelText;
  if (hint) {
    const small = document.createElement('small');
    small.textContent = hint;
    label.append(small);
  }

  const select = document.createElement('select');
  for (const option of options) {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    select.append(node);
  }
  select.value = String(value);
  select.addEventListener('change', () => onChange(select.value));

  row.append(label, select);
  return row;
}

/** Every destination pool that exists, so a site can be pointed at one. */
function groupsInUse() {
  const groups = new Set([DESTINATION_DEFAULTS.group]);
  for (const dest of settings.destinations) groups.add(dest.group);
  for (const entry of settings.blocked) groups.add(entry.group);
  return [...groups].filter(Boolean).sort();
}

function countInGroup(group) {
  return settings.destinations.filter((d) => d.enabled && d.group === group).length;
}

// ------------------------------------------------------------- blocked sites

/** The "sometimes" dials, revealed under a row when you open it. */
function blockedDetail(entry, index) {
  const detail = document.createElement('div');
  detail.className = 'detail';

  detail.append(
    selectRow(
      'Guard',
      'Every visit, or only some of them.',
      [
        { value: GUARD_ALWAYS, label: 'Always redirect' },
        { value: GUARD_SOMETIMES, label: 'Sometimes redirect' },
      ],
      entry.guard,
      (value) => patchBlocked(index, { guard: value }, `${entry.domain} — ${value}`),
    ),
  );

  if (entry.guard === GUARD_SOMETIMES) {
    detail.append(
      selectRow(
        'Redirect me',
        'The rest of the time you go straight through.',
        CHANCE_OPTIONS,
        entry.chance,
        (value) => patchBlocked(index, { chance: Number(value) }),
      ),
      selectRow(
        'Free pass after a break of',
        'Come back rested and the first visit is never redirected.',
        REST_OPTIONS,
        entry.restMinutes,
        (value) => patchBlocked(index, { restMinutes: Number(value) }),
      ),
      selectRow(
        'A visit stays open for',
        'So reading three articles is one roll of the dice, not three.',
        SESSION_OPTIONS,
        entry.sessionMinutes,
        (value) => patchBlocked(index, { sessionMinutes: Number(value) }),
      ),
    );
  }

  detail.append(
    selectRow(
      'Send me to',
      'Which pool of destinations this site detours into.',
      groupsInUse().map((group) => ({
        value: group,
        label: `${group} (${countInGroup(group)} on)`,
      })),
      entry.group,
      (value) => patchBlocked(index, { group: value }),
    ),
  );

  return detail;
}

async function renderBlocked() {
  const entries = await Promise.all(
    settings.blocked.map(async (entry, index) => {
      const wrap = document.createElement('div');
      wrap.className = 'entry';

      const row = document.createElement('div');
      row.className = 'row';

      const isOpen = opened.has(entry.domain);
      const name = iconButton(
        entry.domain,
        'Show this site’s settings',
        `grow mono link disclosure${isOpen ? ' open' : ''}`,
        () => {
          if (isOpen) opened.delete(entry.domain);
          else opened.add(entry.domain);
          render();
        },
      );
      row.append(name);

      if (entry.guard === GUARD_SOMETIMES) {
        const pill = document.createElement('span');
        pill.className = 'pill soft';
        pill.textContent = `${Math.round(entry.chance * 100)}%`;
        pill.title = `Redirected ${Math.round(entry.chance * 100)}% of the time`;
        row.append(pill);
      }

      // Which pool this site lands in — the other half of the page. Only worth
      // saying when it isn't the default one everything else uses.
      if (entry.group !== DESTINATION_DEFAULTS.group) {
        const pill = document.createElement('span');
        pill.className = 'pill soft';
        pill.textContent = `→ ${entry.group}`;
        pill.title = `Detours into the ${entry.group} pool`;
        row.append(pill);
      }

      const granted = await chrome.permissions.contains({
        origins: [originPatternFor(entry.domain)],
      });
      if (!granted) {
        const pill = document.createElement('span');
        pill.className = 'pill';
        pill.textContent = 'needs access';
        row.append(
          pill,
          iconButton('Grant', `Allow Detour to act on ${entry.domain}`, '', () => {
            chrome.permissions
              .request({ origins: [originPatternFor(entry.domain)] })
              .then(() => render());
          }),
        );
      }

      row.append(
        makeSwitch(entry.enabled, `Redirect ${entry.domain}`, (checked) => {
          patchBlocked(
            index,
            { enabled: checked },
            checked ? `${entry.domain} on` : `${entry.domain} off`,
          );
        }),
        iconButton('✕', `Remove ${entry.domain}`, 'ghost danger', async () => {
          opened.delete(entry.domain);
          await save(
            { blocked: settings.blocked.filter((_, i) => i !== index) },
            `Removed ${entry.domain}`,
          );
          // Best effort — Chrome ignores this for permissions declared in the
          // manifest, which is exactly what we want.
          chrome.permissions.remove({ origins: [originPatternFor(entry.domain)] }).catch(() => {});
        }),
      );

      wrap.append(row);
      if (isOpen) wrap.append(blockedDetail(entry, index));
      return wrap;
    }),
  );

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'row muted';
    empty.textContent = 'No sites yet — add one below.';
    entries.push(empty);
  }
  el.blockedList.replaceChildren(...entries);
}

$('addBlocked').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('blockedInput');
  const guard = $('blockedGuard').value;
  const domain = normalizeDomain(input.value);
  el.blockedError.textContent = '';

  if (!domain) {
    el.blockedError.textContent = "That doesn't look like a domain.";
    return;
  }
  if (settings.blocked.some((b) => b.domain === domain)) {
    el.blockedError.textContent = `${domain} is already on the list.`;
    return;
  }

  // Fire the permission prompt first: it must run inside the user gesture.
  chrome.permissions
    .request({ origins: [originPatternFor(domain)] })
    .then((granted) => {
      if (!granted) {
        el.blockedError.textContent = `Detour needs access to ${domain} to redirect it.`;
        return;
      }
      input.value = '';
      // Opened straight away — a "sometimes" site is worth a look at its dials.
      if (guard === GUARD_SOMETIMES) opened.add(domain);
      return save(
        { blocked: [...settings.blocked, { ...BLOCKED_DEFAULTS, domain, guard }] },
        `Added ${domain}`,
      );
    })
    .catch((error) => {
      el.blockedError.textContent = String(error?.message || error);
    });
});

// --------------------------------------------------------------- destinations

function destinationRow(dest, index) {
  const row = document.createElement('div');
  row.className = 'row';

  const label = document.createElement('span');
  label.className = 'grow';
  label.textContent = dest.name || hostOf(dest.url);
  const host = document.createElement('span');
  host.className = 'muted mono';
  host.textContent = `  ${hostOf(dest.url)}`;
  label.append(host);
  row.append(label);

  const clash = settings.blocked.some(
    (b) => b.enabled && (hostOf(dest.url) === b.domain || hostOf(dest.url).endsWith(`.${b.domain}`)),
  );
  if (clash) {
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = 'also blocked';
    pill.title = 'This destination is on the redirect list, so it will be skipped.';
    row.append(pill);
  }

  row.append(
    makeSwitch(dest.enabled, `Use ${dest.name}`, (checked) => {
      save({
        destinations: settings.destinations.map((d, i) =>
          i === index ? { ...d, enabled: checked } : d,
        ),
      });
    }),
    iconButton('✕', `Remove ${dest.name}`, 'ghost danger', () => {
      save(
        { destinations: settings.destinations.filter((_, i) => i !== index) },
        `Removed ${dest.name}`,
      );
    }),
  );
  return row;
}

/** The default pool first, then the rest — a stable order to scan down. */
function poolOrder() {
  const rest = groupsInUse().filter((g) => g !== DESTINATION_DEFAULTS.group);
  return [DESTINATION_DEFAULTS.group, ...rest];
}

/** One card per pool, headed by what feeds it — the two halves of the page
 *  only make sense read together, so each pool says which sites land here. */
function poolCard(group) {
  const card = document.createElement('div');
  card.className = 'card pool';

  const head = document.createElement('div');
  head.className = 'pool-head';
  const name = document.createElement('span');
  name.className = 'pool-name';
  name.textContent = group;

  const all = settings.destinations
    .map((dest, index) => ({ dest, index }))
    .filter(({ dest }) => dest.group === group);
  const on = all.filter(({ dest }) => dest.enabled).length;
  const feeders = settings.blocked.filter((b) => b.enabled && b.group === group);

  // Named in full in the tooltip, trimmed in the header — the creative pool is
  // fed by half the list and would run off the end of the card.
  const names = feeders.map((b) => b.domain);
  const shown = names.slice(0, 3).join(', ');
  const meta = document.createElement('span');
  meta.className = 'pool-meta grow';
  meta.title = names.join(', ');
  meta.textContent =
    `${on} of ${all.length} on · ` +
    (names.length
      ? `${shown}${names.length > 3 ? ` +${names.length - 3} more` : ''} ` +
        `land${names.length === 1 ? 's' : ''} here`
      : 'no site sends you here');
  head.append(name, meta);
  card.append(head);

  const fields = document.createElement('div');
  fields.className = 'fields';
  const rows = all.map(({ dest, index }) => destinationRow(dest, index));

  if (!on) {
    const empty = document.createElement('div');
    empty.className = 'row warn';
    empty.textContent = feeders.length
      ? `Nothing switched on here — ${feeders[0].domain} will fall back to another pool.`
      : 'Nothing switched on here.';
    rows.unshift(empty);
  }

  fields.append(...rows);
  card.append(fields);
  return card;
}

function renderDestinations() {
  el.destList.replaceChildren(...poolOrder().map(poolCard));

  // Feeds the datalist on the add form so pools are picked, not re-typed.
  el.groupOptions.replaceChildren(
    ...groupsInUse().map((group) => {
      const option = document.createElement('option');
      option.value = group;
      return option;
    }),
  );
}

$('addDest').addEventListener('submit', (event) => {
  event.preventDefault();
  const nameInput = $('destName');
  const urlInput = $('destUrl');
  const groupInput = $('destGroup');
  el.destError.textContent = '';

  let raw = urlInput.value.trim();
  if (raw && !/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

  let url;
  try {
    url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) throw new Error('bad protocol');
  } catch {
    el.destError.textContent = 'Enter a full URL, e.g. https://www.cosmos.so';
    return;
  }
  if (settings.destinations.some((d) => d.url === url.href)) {
    el.destError.textContent = 'That destination is already on the list.';
    return;
  }

  const name = nameInput.value.trim() || hostOf(url.href);
  const group = groupInput.value.trim().toLowerCase() || DESTINATION_DEFAULTS.group;
  nameInput.value = '';
  urlInput.value = '';
  groupInput.value = '';
  save(
    { destinations: [...settings.destinations, { name, url: url.href, enabled: true, group }] },
    `Added ${name}`,
  );
});

// ------------------------------------------------------------- rule health

/**
 * What Chrome is actually enforcing right now. A guard that is switched on but
 * has no rule behind it — no host permission, a pass still running, a rule
 * Chrome refused — used to look exactly like a guard that simply never fired.
 */
async function renderRuleStatus() {
  const { lastRuleError, ruleCount, pausedUntil } = await getState();
  el.ruleStatus.classList.toggle('warn', !!lastRuleError);

  if (lastRuleError) {
    el.ruleStatus.textContent = `Chrome refused a rule: ${lastRuleError} — the affected sites fell back to a plain redirect.`;
    return;
  }
  if (!settings.enabled) {
    el.ruleStatus.textContent = 'Detour is switched off — nothing is being redirected.';
    return;
  }
  if (settings.offOnWeekends && isWeekend()) {
    el.ruleStatus.textContent = 'Off for the weekend — nothing is being redirected.';
    return;
  }
  if (pausedUntil > Date.now()) {
    el.ruleStatus.textContent = 'Paused — nothing is being redirected right now.';
    return;
  }

  const on = settings.blocked.filter((b) => b.enabled).length;
  const gap = on - ruleCount;
  el.ruleStatus.textContent =
    `${ruleCount} of ${on} switched-on site${on === 1 ? '' : 's'} guarded right now` +
    (gap > 0 ? ' — the rest need access, or are open on a pass.' : '.');
}

// -------------------------------------------------------------------- stats

async function renderStats() {
  const { stats } = await getState();
  const today = stats.days?.[todayKey()] || 0;
  const top = Object.entries(stats.byDomain || {}).sort((a, b) => b[1] - a[1])[0];

  const items = [
    ['Today', today],
    ['All time', stats.total || 0],
    ['Let through', stats.allowed || 0],
    ['Most tempting', top ? `${top[0]}` : '—'],
  ];

  el.stats.replaceChildren(
    ...items.map(([label, value]) => {
      const box = document.createElement('div');
      box.className = 'stat';
      const strong = document.createElement('b');
      strong.textContent = String(value);
      const caption = document.createElement('span');
      caption.className = 'eyebrow';
      caption.textContent = label;
      box.append(strong, caption);
      return box;
    }),
  );
}

// -------------------------------------------------------------------- render

async function render() {
  settings = await getSettings();

  el.master.checked = settings.enabled;
  el.mode.value = settings.mode;
  el.delay.value = String(settings.interstitialMs);
  el.pickMode.value = settings.pickMode;
  el.passMinutes.value = String(settings.passMinutes);
  el.offOnWeekends.checked = settings.offOnWeekends;
  el.delayRow.style.display = settings.mode === 'interstitial' ? '' : 'none';

  renderDestinations();
  await Promise.all([renderBlocked(), renderStats(), renderRuleStatus()]);
}

el.master.addEventListener('change', () => save({ enabled: el.master.checked }));
el.mode.addEventListener('change', () => save({ mode: el.mode.value }));
el.delay.addEventListener('change', () => save({ interstitialMs: Number(el.delay.value) }));
el.pickMode.addEventListener('change', () => save({ pickMode: el.pickMode.value, rotateIndex: 0 }));
el.passMinutes.addEventListener('change', () =>
  save({ passMinutes: Number(el.passMinutes.value) }),
);
el.offOnWeekends.addEventListener('change', () =>
  save({ offOnWeekends: el.offOnWeekends.checked }),
);

$('resetStats').addEventListener('click', async () => {
  await setState({ stats: { total: 0, allowed: 0, byDomain: {}, days: {} } });
  flash('Tally cleared');
  renderStats();
});

$('resetAll').addEventListener('click', async () => {
  if (!confirm('Restore the default sites, destinations and behaviour?')) return;
  await resetSettings();
  await chrome.runtime.sendMessage({ type: 'rebuild' });
  flash('Defaults restored');
  render();
});

render();
