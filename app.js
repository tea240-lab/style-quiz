'use strict';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));

let game;
let busy = false;
let revision = 0;
let showRanks = false;
let audio;
let muted = true;
let joinData;
let qrRevision = 0;
const qrBlobs = [];

const tiles = Array.from({length: 36}, (_, index) => {
  const button = document.createElement('button');
  button.className = 'tile';
  button.disabled = true;
  button.addEventListener('click', () => {
    if (!canFlip() || game.cards[index] !== null) return;
    if (!audio) enableAudio();
    action('flip', {card: index});
  });
  $('board').append(button);
  return button;
});

for (let count = 2; count <= 10; count++) {
  $('groups').add(new Option(count + ' 組', String(count)));
}

function canFlip() {
  return game && Number.isInteger(game.role) && game.role === game.active && !game.locked && !busy;
}

function render() {
  const teacher = game.role === 'teacher';
  const left = 36 - game.events.length;
  const activeName = `第 ${game.active + 1} 組`;
  const nextGroup = (game.active + 1) % game.scores.length + 1;
  const latest = game.events[game.events.length - 1];
  const flipped = latest?.turn === game.turn;
  $('game').hidden = false;
  $('welcome').hidden = true;
  $('mode').textContent = teacher ? '教師投影端' : `第 ${game.role + 1} 組 · 學生端`;
  $('turn').textContent = left ? `第 ${game.roundNumber} 回合 · ${activeName}` : '36 張牌已全部翻開';
  $('remaining').textContent = left;
  $('gate').hidden = !teacher || !left || flipped;
  $('gate').disabled = busy;
  $('gate').textContent = game.locked ? '答對 · 開放翻牌' : '暫停翻牌';
  $('next').hidden = !teacher;
  $('next').disabled = busy || !game.locked || !left;
  $('next').textContent = left ? `${flipped ? '下一組' : '跳過本組'} · 第 ${nextGroup} 組 →` : '本局結束';
  $('rank').hidden = !teacher;
  $('join').hidden = !teacher;
  $('reset').hidden = !teacher;
  $('reset').disabled = busy;
  const playable = canFlip();
  tiles.forEach((tile, index) => {
    const card = game.cards[index];
    tile.disabled = !playable || card !== null;
    tile.classList.toggle('ready', playable && card === null);
    const marker = card === null ? 'closed' : card.value === 0 ? 'mine' : 'safe';
    if (tile.dataset.face === marker && tile.dataset.game === game.id) return;
    tile.dataset.face = marker;
    tile.dataset.game = game.id;
    const top = document.createElement('small');
    top.textContent = card ? String(index + 1).padStart(2, '0') : '';
    const face = document.createElement('span');
    face.textContent = card ? (card.value ? '+' + card.value : '💣') : String(index + 1);
    tile.replaceChildren(top, face);
    const detail = card ? `，第 ${card.group + 1} 組翻到${card.value ? '加 ' + card.value + ' 分' : '地雷'}` : '';
    tile.setAttribute('aria-label', `${index + 1} 號${detail}`);
  });

  const status = $('status');
  let title;
  let note;
  if (flipped) {
    const team = `第 ${latest.group + 1} 組`;
    title = latest.value ? `${team} ＋${latest.value} 分` : `${team} 踩到地雷！`;
    note = `${latest.card + 1} 號牌 · ${latest.before} → ${latest.score} 分`;
    if (left && !teacher) note += ' · 等老師開放下一組';
    if (!left) note += ' · 本局結束';
  } else if (game.locked) {
    title = `${activeName}等待老師放行`;
    note = teacher ? '答對可開放翻牌。未答對可繼續等待，或跳過本組。' : '等老師開放後，再選一張牌。';
  } else {
    title = playable ? '輪到你們！' : `${activeName}可以翻牌`;
    note = playable ? '點一個號碼，翻開一張牌。' : '等這一組在 iPad 選號翻牌。';
  }
  $('status-panel').classList.toggle('danger', Boolean(flipped && !latest.value));
  const headline = document.createElement('strong');
  headline.textContent = title;
  const detail = document.createElement('p');
  detail.textContent = note;
  status.replaceChildren(headline, detail);
  renderScores();
}

function renderScores() {
  const rows = game.scores.map((score, group) => ({score, group}));
  if (showRanks) rows.sort((a, b) => b.score - a.score || a.group - b.group);
  $('score-heading').textContent = showRanks ? '分數排名' : '各組分數';
  $('rank').textContent = showRanks ? '組別順序' : '名次';
  $('rank').setAttribute('aria-pressed', String(showRanks));
  let rank = 0;
  $('scores').replaceChildren(...rows.map(({score, group}, i) => {
    if (i === 0 || score !== rows[i - 1].score) rank = i + 1;
    const item = document.createElement('li');
    item.classList.toggle('active', group === game.active && game.events.length < 36);
    item.classList.toggle('own', group === game.role);
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = showRanks ? String(rank) : String(group + 1).padStart(2, '0');
    if (showRanks) badge.setAttribute('aria-label', `第 ${rank} 名`);
    const name = document.createElement('span');
    name.textContent = `第 ${group + 1} 組${group === game.role ? '（你們）' : ''}`;
    const total = document.createElement('strong');
    total.textContent = score;
    if (game.role === 'teacher') {
      const controls = document.createElement('span');
      controls.className = 'score-adjust';
      for (const delta of [-1, 1]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = delta < 0 ? '−1' : '＋1';
        button.disabled = busy || (delta < 0 && score === 0);
        button.setAttribute('aria-label', `第 ${group + 1} 組${delta < 0 ? '扣' : '加'} 1 分`);
        button.addEventListener('click', () => action('adjust', {group, delta}));
        if (delta > 0) controls.append(total);
        controls.append(button);
      }
      item.append(badge, name, controls);
    } else {
      item.append(badge, name, total);
    }
    return item;
  }));
}

function accept(state) {
  const previous = game;
  game = state;
  const newGame = previous?.id !== state.id;
  if (newGame) showRanks = false;
  if (!newGame && state.events.length > previous.events.length) {
    const newest = state.events[state.events.length - 1];
    if (state.role === 'teacher' || newest.group === state.role) sound(newest.value);
  }
  if (newGame || previous.turn !== state.turn || previous.locked !== state.locked || previous.events.length !== state.events.length ||
      state.scores.some((score, group) => score !== previous.scores[group])) {
    $('error').hidden = true;
    render();
  }
}

async function request(path, method = 'GET', body) {
  return transport.request(path, body);
}

function connected(ok) {
  $('connection').classList.toggle('offline', !ok);
  $('connection').lastChild.textContent = ok ? ' 已連線' : ' 連線中斷，正在重連';
}

function welcome(message) {
  $('welcome').textContent = message;
  $('welcome').hidden = false;
  $('game').hidden = true;
  $('mode').textContent = '加入遊戲';
}

async function poll() {
  const start = revision;
  if (!busy) {
    try {
      const state = await request('state');
      if (start === revision) {
        accept(state);
        $('welcome').hidden = true;
        $('game').hidden = false;
        connected(true);
      }
    } catch (error) {
      if (start === revision) {
        if (error.code === 403 || !game) {
          welcome(error.code === 403 ? error.message : '正在重連。請確認網路及教師端已開啟。');
        } else {
          connected(false);
        }
      }
    }
  }
  setTimeout(poll, 1200);
}

async function action(path, fields = {}) {
  if (busy || !game) return false;
  busy = true;
  revision++;
  $('error').hidden = true;
  $('reset-error').hidden = true;
  render();
  try {
    accept(await request(path, 'POST', {id: game.id, turn: game.turn, ...fields}));
    connected(true);
    return true;
  } catch (error) {
    if (error.state) accept(error.state);
    const target = path === 'reset' ? $('reset-error') : $('error');
    target.textContent = error.code ? error.message : '連線中斷，請確認牌盤更新後再試。';
    target.hidden = false;
    return false;
  } finally {
    busy = false;
    render();
  }
}

function enableAudio() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume().catch(() => {});
    muted = false;
    $('sound').setAttribute('aria-pressed', 'true');
    $('sound').textContent = '🔊 音效開啟';
  } catch {
    $('sound').textContent = '此瀏覽器無法播放音效';
  }
}

function sound(value) {
  if (muted || !audio || audio.state !== 'running') return;
  const time = audio.currentTime;
  const output = audio.createGain();
  output.connect(audio.destination);
  output.gain.setValueAtTime(value ? 0.17 : 0.32, time);
  output.gain.exponentialRampToValueAtTime(0.001, time + 0.52);
  if (value) {
    [523, 659, 784].slice(0, value >= 3 ? 3 : 2).forEach((frequency, i) => {
      const wave = audio.createOscillator();
      wave.frequency.value = frequency;
      wave.connect(output);
      wave.start(time + i * 0.085);
      wave.stop(time + i * 0.085 + 0.19);
    });
    return;
  }
  const boom = audio.createOscillator();
  boom.type = 'triangle';
  boom.frequency.setValueAtTime(155, time);
  boom.frequency.exponentialRampToValueAtTime(36, time + 0.4);
  boom.connect(output);
  boom.start(time);
  boom.stop(time + 0.52);
  const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.22), audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const noise = audio.createBufferSource();
  noise.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 850;
  noise.connect(filter).connect(output);
  noise.start(time);
}

async function showQRs() {
  const version = ++qrRevision;
  for (const blob of qrBlobs.splice(0)) URL.revokeObjectURL(blob);
  const origin = $('network').value;
  const grid = $('qr-grid');
  grid.replaceChildren();
  if (!origin) {
    grid.textContent = '暫時無法取得遊戲網址，請重整頁面。';
    return;
  }
  for (const [i, key] of joinData.keys.entries()) {
    const url = `${origin}#${key}`;
    const card = document.createElement('article');
    const title = document.createElement('strong');
    title.textContent = `第 ${i + 1} 組`;
    const img = document.createElement('img');
    img.alt = `第 ${i + 1} 組的 QR Code`;
    img.hidden = true;
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '開啟組別網址';
    card.append(title, img, link);
    grid.append(card);
    request('qr', 'POST', {url}).then(blob => {
      if (version !== qrRevision) return;
      const src = URL.createObjectURL(blob);
      qrBlobs.push(src);
      img.src = src;
      img.hidden = false;
    }).catch(() => {
      if (version === qrRevision) link.textContent = 'QR Code 載入失敗，開啟網址';
    });
  }
}

$('join').addEventListener('click', async () => {
  $('qr-grid').textContent = '正在產生各組 QR Code…';
  $('network-label').hidden = true;
  $('join-dialog').showModal();
  try {
    joinData = await request('join');
    $('network').replaceChildren(...joinData.origins.map(origin => new Option(origin, origin)));
    $('network-label').hidden = joinData.origins.length < 2;
    showQRs();
  } catch {
    $('qr-grid').textContent = 'QR Code 無法載入，請確認連線後重試。';
  }
});
$('network').addEventListener('change', showQRs);
$('rank').addEventListener('click', () => {
  showRanks = !showRanks;
  renderScores();
});
$('gate').addEventListener('click', () => {
  if (!audio) enableAudio();
  action(game.locked ? 'open' : 'pause');
});
$('next').addEventListener('click', () => {
  if (!audio) enableAudio();
  action('next');
});
$('sound').addEventListener('click', () => {
  if (muted) {
    enableAudio();
    setTimeout(() => sound(2), 60);
  } else {
    muted = true;
    $('sound').setAttribute('aria-pressed', 'false');
    $('sound').textContent = '🔇 音效關閉';
  }
});
$('reset').addEventListener('click', () => {
  $('groups').value = String(game.scores.length);
  $('reset-error').hidden = true;
  $('reset-dialog').showModal();
});
$('cancel-reset').addEventListener('click', () => $('reset-dialog').close());
$('reset-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (await action('reset', {groups: Number($('groups').value)})) $('reset-dialog').close();
});

const transport = initMinefield(params);
if (transport.student) {
  poll();
} else {
  $('teacher-login').hidden = false;
  $('mode').textContent = '教師登入';
  $('teacher-login').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('teacher-login').querySelector('button');
    button.disabled = true;
    $('login-error').textContent = '';
    try {
      await transport.login($('teacher-email').value.trim(), $('teacher-password').value);
      $('teacher-password').value = '';
      $('teacher-login').hidden = true;
      poll();
    } catch (error) {
      $('login-error').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}
