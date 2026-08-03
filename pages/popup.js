import { GUARD_SOMETIMES } from '../src/defaults.js';
import { getSettings, setSettings, getState, todayKey } from '../src/storage.js';

const el = {
  master: document.getElementById('master'),
  status: document.getElementById('status'),
  list: document.getElementById('list'),
  pause: document.getElementById('pause'),
  options: document.getElementById('options'),
};

let settings;

function minutesLeft(until) {
  return Math.max(1, Math.ceil((until - Date.now()) / 60_000));
}

async function render() {
  settings = await getSettings();
  const state = await getState();
  const paused = state.pausedUntil > Date.now();

  el.master.checked = settings.enabled;

  const today = state.stats.days?.[todayKey()] || 0;
  if (!settings.enabled) {
    el.status.innerHTML = '<b>Off.</b> Nothing is being redirected.';
  } else if (paused) {
    el.status.innerHTML = `<b>Paused</b> for ${minutesLeft(state.pausedUntil)} more min.`;
  } else {
    const on = settings.blocked.filter((b) => b.enabled).length;
    el.status.innerHTML = `Guarding <b>${on}</b> site${on === 1 ? '' : 's'} · <b>${today}</b> detour${today === 1 ? '' : 's'} today`;
  }

  el.pause.textContent = paused ? 'Resume now' : 'Pause 15 min';

  el.list.replaceChildren(
    ...settings.blocked.map((entry, index) => {
      const row = document.createElement('div');
      row.className = 'row';

      const name = document.createElement('span');
      name.className = 'grow';
      name.textContent = entry.domain;
      const note = document.createElement('span');
      note.className = 'muted';
      if (state.passes[entry.domain] > Date.now()) {
        note.textContent = ` — open ${minutesLeft(state.passes[entry.domain])}m`;
      } else if (entry.guard === GUARD_SOMETIMES) {
        note.textContent = ` — ${Math.round(entry.chance * 100)}% of visits`;
      }
      if (note.textContent) name.append(note);

      const label = document.createElement('label');
      label.className = 'switch';
      label.title = `Redirect ${entry.domain}`;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = entry.enabled;
      input.addEventListener('change', async () => {
        const blocked = settings.blocked.map((b, i) =>
          i === index ? { ...b, enabled: input.checked } : b,
        );
        await setSettings({ blocked });
        render();
      });
      const track = document.createElement('span');
      track.className = 'track';
      label.append(input, track);

      row.append(name, label);
      return row;
    }),
  );
}

el.master.addEventListener('change', async () => {
  await setSettings({ enabled: el.master.checked });
  render();
});

el.pause.addEventListener('click', async () => {
  const state = await getState();
  const paused = state.pausedUntil > Date.now();
  await chrome.runtime.sendMessage(paused ? { type: 'resume' } : { type: 'pause', minutes: 15 });
  render();
});

el.options.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

render();
