let allCards = [];
let filtered = [];
let levels = [];
let selectedLevel = '';
let current = 0;
let audio = new Audio();
let playToken = 0;
let sessionStudied = new Set();

const STORAGE_KEY = 'mandarinSentenceStudyStateV1';
const DATA_ROOT = 'data';
const OFFLINE_CACHE = 'mandarin-sentence-offline-v4';
const OFFLINE_MANIFEST = 'offline-assets.json';
const today = () => new Date().toISOString().slice(0, 10);
const $ = (id) => document.getElementById(id);

const state = loadState();

function defaultState() {
  return {
    settings: {
      playbackRate: 1,
      mode: 'browse',
      filter: 'all',
      searchScope: 'all',
      loop: false,
      repeats: 3,
      voiceMode: 'selected',
      theme: 'light',
      lastLevel: '',
      currentByLevel: {},
    },
    cards: {},
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const base = defaultState();
    return {
      settings: {...base.settings, ...(saved.settings || {})},
      cards: {...base.cards, ...(saved.cards || {})},
    };
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function cardState(cardId) {
  if (!state.cards[cardId]) {
    state.cards[cardId] = {
      hard: false,
      notes: '',
      studied: 0,
      lastStudied: '',
      due: today(),
      rating: '',
    };
  }
  return state.cards[cardId];
}

function activeCard() {
  return filtered[current];
}

function activeAllCard() {
  return allCards.find(card => card.id === activeCard()?.id);
}

function normalise(card) {
  const scope = state.settings.searchScope;
  if (scope === 'chinese') return card.Chinese || '';
  if (scope === 'english') return card.English || '';
  if (scope === 'characters') return card.characters || '';
  return `${card.Chinese || ''} ${card.English || ''} ${card.characters || ''}`;
}

function applyFilter() {
  const q = $('search').value.trim().toLowerCase();
  filtered = allCards.filter(card => {
    const progress = cardState(card.id);
    const matchesText = !q || normalise(card).toLowerCase().includes(q);
    const matchesFilter =
      state.settings.filter === 'all' ||
      (state.settings.filter === 'hard' && progress.hard) ||
      (state.settings.filter === 'due' && (!progress.due || progress.due <= today()));
    return matchesText && matchesFilter;
  });
  if (current >= filtered.length) current = 0;
  persistCurrent();
  render();
}

function reveal() {
  document.body.classList.add('answerShown');
  $('revealBtn').textContent = 'Revealed';
}

function hideAnswer() {
  document.body.classList.remove('answerShown');
  $('revealBtn').textContent = 'Reveal';
}

function goToCard(index) {
  if (!filtered.length) return;
  current = (index + filtered.length) % filtered.length;
  persistCurrent();
  hideAnswer();
  render();
}

function persistCurrent() {
  if (selectedLevel) {
    state.settings.currentByLevel[selectedLevel] = activeCard()?.id || '';
    saveState();
  }
}

function setMode(mode) {
  state.settings.mode = mode;
  saveState();
  hideAnswer();
  render();
}

function setPlaybackRate(value) {
  state.settings.playbackRate = Number(value) || 1;
  saveState();
  applyPlaybackRate();
}

function applyTheme() {
  document.body.dataset.theme = state.settings.theme;
  $('themeToggle').textContent = state.settings.theme === 'dark' ? 'Light' : 'Dark';
}

function toggleTheme() {
  state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
  saveState();
  applyTheme();
}

function applyPlaybackRate() {
  audio.playbackRate = state.settings.playbackRate;
  const player = $('cardAudio');
  if (player) player.playbackRate = state.settings.playbackRate;
}

function audioSrc(card, which) {
  const field = which === '2' ? 'Audio 2' : 'Audio 1';
  return (card?.[field] || '').trim();
}

function audioIsLocal(card, which) {
  const field = which === '2' ? 'Audio 2' : 'Audio 1';
  return card?.[`${field} Local`] === 'true';
}

function preferredVoice(card) {
  return audioSrc(card, '1') ? '1' : '2';
}

function waitForAudioEnded(player) {
  return new Promise((resolve, reject) => {
    player.addEventListener('ended', resolve, {once: true});
    player.addEventListener('pause', resolve, {once: true});
    player.addEventListener('error', () => reject(new Error('Audio failed to play.')), {once: true});
  });
}

async function playOne(src, token) {
  if (!src || token !== playToken) return;
  audio.pause();
  audio = new Audio(src);
  audio.preload = 'auto';
  audio.playbackRate = state.settings.playbackRate;
  await audio.play();
  const player = $('cardAudio');
  if (player) {
    player.src = src;
    player.playbackRate = state.settings.playbackRate;
  }
  await waitForAudioEnded(audio);
}

function audioPlan(card, which) {
  const repeats = state.settings.loop ? Number(state.settings.repeats) || 3 : 1;
  const voices = [];
  for (let i = 0; i < repeats; i += 1) {
    if (state.settings.voiceMode === 'alternate') {
      voices.push(i % 2 === 0 ? which : (which === '1' ? '2' : '1'));
    } else {
      voices.push(which);
    }
  }
  return voices.map(voice => audioSrc(card, voice)).filter(Boolean);
}

async function playCardAudio(cardId, which = '') {
  try {
    const card = allCards.find(c => c.id === cardId);
    if (!card) throw new Error(`Could not find card ${cardId}.`);
    const voice = which || preferredVoice(card);
    const plan = audioPlan(card, voice);
    if (!plan.length) throw new Error('No audio file for this card.');

    playToken += 1;
    const token = playToken;
    for (const src of plan) {
      await playOne(src, token);
      if (token !== playToken) return;
    }
  } catch (err) {
    console.error('Audio play failed', err);
    alert(`Could not play audio: ${err.message}`);
  }
}

function markStudied(card, rating) {
  const progress = cardState(card.id);
  const now = new Date();
  const days = rating === 'again' ? 0 : rating === 'good' ? 2 : 7;
  progress.studied += 1;
  progress.lastStudied = today();
  progress.due = new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
  progress.rating = rating;
  if (rating === 'again') progress.hard = true;
  if (rating === 'easy') progress.hard = false;
  sessionStudied.add(card.id);
  saveState();
  render();
}

function toggleHard(card) {
  const progress = cardState(card.id);
  progress.hard = !progress.hard;
  if (progress.hard) progress.due = today();
  saveState();
  render();
}

function saveNote(cardId, value) {
  cardState(cardId).notes = value;
  saveState();
  renderList();
}

function renderCard(card) {
  if (!card) return '<p class="muted">No matching cards.</p>';
  const progress = cardState(card.id);
  const mode = state.settings.mode;
  const showChinese = mode !== 'english' && mode !== 'audio';
  const showEnglish = mode === 'browse';
  const audioOnly = mode === 'audio';
  const shadow = mode === 'shadow';
  const firstAudio = audioSrc(card, '1') || audioSrc(card, '2');

  return `
    <div class="cardTopline">
      <span class="pill ${progress.hard ? 'hard' : ''}">${progress.hard ? 'Hard' : 'Active'}</span>
      <span class="muted">${progress.studied ? `${progress.studied} reviews` : 'New card'}</span>
      <span class="muted">${progress.due ? `Due ${escapeHtml(progress.due)}` : 'Due today'}</span>
    </div>

    ${showChinese ? `<p class="chinese">${escapeHtml(card.Chinese || '')}</p>` : ''}
    ${mode === 'english' ? `<p class="english promptOnly">${escapeHtml(card.English || '')}</p>` : ''}
    ${audioOnly ? '<p class="audioPrompt">Listen first, then reveal.</p>' : ''}
    ${showEnglish ? `<p class="english">${escapeHtml(card.English || '')}</p>` : ''}

    <div class="answerBlock">
      ${mode !== 'browse' && mode !== 'english' ? `<p class="english">${escapeHtml(card.English || '')}</p>` : ''}
      ${mode === 'english' || mode === 'audio' ? `<p class="chinese answerChinese">${escapeHtml(card.Chinese || '')}</p>` : ''}
      ${card.characters ? `<div class="characters">${escapeHtml(card.characters)}</div>` : ''}
    </div>

    ${shadow ? '<div class="shadowCue">Shadowing mode</div>' : ''}

    <div class="audioRow">
      ${audioSrc(card, '1') ? `<button onclick="playCardAudio('${escapeAttr(card.id)}', '1')">Play Audio 1 ${audioIsLocal(card, '1') ? 'Local' : 'Online'}</button>` : ''}
      ${audioSrc(card, '2') ? `<button onclick="playCardAudio('${escapeAttr(card.id)}', '2')">Play Audio 2 ${audioIsLocal(card, '2') ? 'Local' : 'Online'}</button>` : ''}
      <button class="secondary" onclick="playCardAudio('${escapeAttr(card.id)}')">Play Preferred</button>
    </div>
    <audio id="cardAudio" controls preload="none" src="${escapeAttr(firstAudio)}"></audio>

    <div class="reviewRow">
      <button class="secondary" onclick="toggleHard(activeAllCard())">${progress.hard ? 'Unmark Hard' : 'Mark Hard'}</button>
      <button onclick="markStudied(activeAllCard(), 'again')">Again</button>
      <button onclick="markStudied(activeAllCard(), 'good')">Good</button>
      <button onclick="markStudied(activeAllCard(), 'easy')">Easy</button>
    </div>

    <div class="mobileCardActions" aria-label="Card navigation">
      <button type="button" onclick="goToCard(current - 1)">Previous</button>
      <button type="button" onclick="goToCard(current + 1)">Next</button>
      <button type="button" class="secondary" onclick="reveal()">Reveal</button>
      <button type="button" class="secondary" onclick="playCardAudio('${escapeAttr(card.id)}')">Play</button>
    </div>

    <label class="notesBox">
      <span>Notes</span>
      <textarea id="notesInput" rows="3" placeholder="Grammar, pronunciation, memory hook...">${escapeHtml(progress.notes)}</textarea>
    </label>

    <details>
      <summary>Raw card text</summary>
      <pre>${escapeHtml(card['Raw Text'] || '')}</pre>
    </details>
  `;
}

function renderList() {
  $('cardList').innerHTML = filtered.map((card, i) => {
    const progress = cardState(card.id);
    const flags = [
      progress.hard ? 'Hard' : '',
      progress.due && progress.due <= today() ? 'Due' : '',
      progress.notes ? 'Note' : '',
    ].filter(Boolean).join(' · ');
    return `
      <li><button class="${i === current ? 'active' : ''}" onclick="goToCard(${i})">
        <strong>${i + 1}.</strong> ${escapeHtml(card.Chinese || '')}<br>
        <span class="muted">${escapeHtml(card.English || '')}</span>
        ${flags ? `<small>${escapeHtml(flags)}</small>` : ''}
      </button></li>
    `;
  }).join('');
}

function renderLevels() {
  $('levelSelect').innerHTML = levels.map(level => `
    <option value="${escapeAttr(level.id)}"${level.id === selectedLevel ? ' selected' : ''}>
      ${escapeHtml(level.label)}
    </option>
  `).join('');
  $('levelList').innerHTML = levels.map(level => {
    const levelCards = Object.keys(state.cards).filter(id => id.startsWith(`${level.id}:`));
    const studied = levelCards.filter(id => state.cards[id]?.studied).length;
    const percent = level.count ? Math.round((studied / level.count) * 100) : 0;
    return `
      <li><button class="${level.id === selectedLevel ? 'active' : ''}" onclick="loadCards('${escapeAttr(level.id)}')">
        <strong>${escapeHtml(level.label)}</strong>
        <span>${studied}/${level.count || 0} studied · ${percent}%</span>
      </button></li>
    `;
  }).join('');
  $('levelCount').textContent = `${levels.length} levels`;
  updateLevelButtons();
}

function selectedLevelIndex() {
  return levels.findIndex(level => level.id === selectedLevel);
}

function updateLevelButtons() {
  const i = selectedLevelIndex();
  $('prevLevelBtn').disabled = i <= 0;
  $('nextLevelBtn').disabled = i < 0 || i >= levels.length - 1;
}

function renderStats() {
  const hard = allCards.filter(card => cardState(card.id).hard).length;
  const due = allCards.filter(card => !cardState(card.id).due || cardState(card.id).due <= today()).length;
  const studied = allCards.filter(card => cardState(card.id).studied).length;
  const percent = allCards.length ? Math.round((studied / allCards.length) * 100) : 0;
  $('todayCount').textContent = String(sessionStudied.size);
  $('hardCount').textContent = String(hard);
  $('dueCount').textContent = String(due);
  $('levelProgress').textContent = `${percent}%`;
}

function syncControls() {
  $('modeSelect').value = state.settings.mode;
  $('filterSelect').value = state.settings.filter;
  $('searchScope').value = state.settings.searchScope;
  $('speedSelect').value = String(state.settings.playbackRate);
  $('loopToggle').checked = state.settings.loop;
  $('repeatCount').value = String(state.settings.repeats);
  $('voiceMode').value = state.settings.voiceMode;
}

function setOfflineStatus(message) {
  const status = $('offlineStatus');
  if (status) status.textContent = message;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    setOfflineStatus('Offline save unavailable');
    const button = $('offlineBtn');
    if (button) button.disabled = true;
    return;
  }
  try {
    await navigator.serviceWorker.register('service-worker.js');
    setOfflineStatus('Ready for offline save');
  } catch (err) {
    console.error('Service worker registration failed', err);
    setOfflineStatus('Offline setup failed');
  }
}

async function cacheAsset(cache, asset) {
  const url = new URL(asset, window.location.href);
  const request = new Request(url.href, {cache: 'reload'});
  const response = await fetch(request);
  if (!response.ok) throw new Error(`${response.status} ${asset}`);
  await cache.put(url.href, response);
}

async function saveOffline() {
  const button = $('offlineBtn');
  if (!('caches' in window)) {
    setOfflineStatus('Offline save unavailable');
    return;
  }

  try {
    if (button) {
      button.disabled = true;
      button.textContent = 'Saving...';
    }
    setOfflineStatus('Preparing...');

    const manifestResponse = await fetch(OFFLINE_MANIFEST, {cache: 'reload'});
    if (!manifestResponse.ok) throw new Error('Could not load offline asset list.');
    const manifest = await manifestResponse.json();
    const assets = [...new Set([...(manifest.assets || []), OFFLINE_MANIFEST])];
    const cache = await caches.open(OFFLINE_CACHE);
    let completed = 0;
    let failed = 0;

    for (const asset of assets) {
      try {
        await cacheAsset(cache, asset);
      } catch (err) {
        failed += 1;
        console.warn('Offline cache failed', asset, err);
      }
      completed += 1;
      if (completed === 1 || completed % 10 === 0 || completed === assets.length) {
        setOfflineStatus(`${completed}/${assets.length} saved`);
      }
    }

    if (failed) {
      setOfflineStatus(`${assets.length - failed}/${assets.length} saved`);
      alert(`${failed} files could not be saved offline. Try again on a stronger connection.`);
    } else {
      setOfflineStatus('Saved offline');
    }
  } catch (err) {
    console.error('Offline save failed', err);
    setOfflineStatus('Offline save failed');
    alert(`Could not save offline: ${err.message}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Save offline';
    }
  }
}

function render() {
  const card = activeCard();
  document.body.dataset.mode = state.settings.mode;
  applyTheme();
  $('card').innerHTML = renderCard(card);
  $('position').textContent = filtered.length ? `${current + 1} / ${filtered.length}` : '0 / 0';
  $('filteredCount').textContent = `${filtered.length} shown`;
  updateLevelButtons();
  applyPlaybackRate();
  renderStats();
  renderLevels();
  renderList();
  const notes = $('notesInput');
  if (notes && card) notes.addEventListener('input', (e) => saveNote(card.id, e.target.value));
}

async function loadCards(levelId) {
  try {
    const res = await fetch(`${DATA_ROOT}/levels/${encodeURIComponent(levelId || '')}.json`);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Could not load cards.');

    selectedLevel = data.level;
    state.settings.lastLevel = selectedLevel;
    allCards = data.cards || [];
    filtered = [...allCards];
    const savedCard = state.settings.currentByLevel[selectedLevel];
    current = Math.max(0, filtered.findIndex(card => card.id === savedCard));
    $('search').value = '';
    $('fileInfo').textContent = `${data.levelLabel}: ${data.count} cards`;
    saveState();
    hideAnswer();
    applyFilter();
  } catch (err) {
    $('fileInfo').textContent = 'Could not load spreadsheet.';
    $('card').innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

async function loadLevels() {
  try {
    const res = await fetch(`${DATA_ROOT}/levels.json`);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Could not load levels.');

    levels = data.levels || [];
    selectedLevel = state.settings.lastLevel || data.defaultLevel || levels[0]?.id || '';
    if (!levels.length) throw new Error(`No level spreadsheets found in ${data.folder}.`);
    if (!levels.some(level => level.id === selectedLevel)) selectedLevel = data.defaultLevel || levels[0].id;
    renderLevels();
    await loadCards(selectedLevel);
  } catch (err) {
    $('fileInfo').textContent = 'Could not load levels.';
    $('card').innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/`/g, '&#96;');
}

function isTypingTarget(target) {
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

$('search').addEventListener('input', applyFilter);
$('prevBtn').addEventListener('click', () => goToCard(current - 1));
$('nextBtn').addEventListener('click', () => goToCard(current + 1));
$('randomBtn').addEventListener('click', () => goToCard(Math.floor(Math.random() * filtered.length)));
$('revealBtn').addEventListener('click', reveal);
$('levelSelect').addEventListener('change', (e) => loadCards(e.target.value));
$('prevLevelBtn').addEventListener('click', () => {
  const i = selectedLevelIndex();
  if (i > 0) loadCards(levels[i - 1].id);
});
$('nextLevelBtn').addEventListener('click', () => {
  const i = selectedLevelIndex();
  if (i >= 0 && i < levels.length - 1) loadCards(levels[i + 1].id);
});
$('speedSelect').addEventListener('change', (e) => setPlaybackRate(e.target.value));
$('themeToggle').addEventListener('click', toggleTheme);
$('modeSelect').addEventListener('change', (e) => setMode(e.target.value));
$('filterSelect').addEventListener('change', (e) => {
  state.settings.filter = e.target.value;
  saveState();
  applyFilter();
});
$('searchScope').addEventListener('change', (e) => {
  state.settings.searchScope = e.target.value;
  saveState();
  applyFilter();
});
$('loopToggle').addEventListener('change', (e) => {
  state.settings.loop = e.target.checked;
  saveState();
});
$('repeatCount').addEventListener('change', (e) => {
  state.settings.repeats = Number(e.target.value) || 3;
  saveState();
});
$('voiceMode').addEventListener('change', (e) => {
  state.settings.voiceMode = e.target.value;
  saveState();
});
$('offlineBtn').addEventListener('click', saveOffline);

document.addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target)) return;
  const card = activeCard();
  if (e.key === 'ArrowRight') goToCard(current + 1);
  if (e.key === 'ArrowLeft') goToCard(current - 1);
  if (e.key === 'Enter') reveal();
  if (e.key === ' ' && card) {
    e.preventDefault();
    playCardAudio(card.id);
  }
  if (e.key === '1' && card) playCardAudio(card.id, '1');
  if (e.key === '2' && card) playCardAudio(card.id, '2');
  if (e.key.toLowerCase() === 's' && card) toggleHard(card);
  if (e.key.toLowerCase() === 'a' && card) markStudied(card, 'again');
  if (e.key.toLowerCase() === 'g' && card) markStudied(card, 'good');
  if (e.key.toLowerCase() === 'e' && card) markStudied(card, 'easy');
});

syncControls();
applyTheme();
registerServiceWorker();
loadLevels();
