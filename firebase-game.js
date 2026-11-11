'use strict';

function initMinefield(params) {
  const teacherUid = 'GFEogGHdrzOHu6oOgmidenFGX5o2';
  const savedRoomKey = 'minefield-room-v1';
  const student = params.has('room') || params.has('group');
  const team = Number(params.get('group'));
  const code = params.get('code') || '';
  const roomId = params.get('room') || '';
  const token = () => Array.from(crypto.getRandomValues(new Uint8Array(20)),
    byte => byte.toString(16).padStart(2, '0')).join('');
  const tokenPattern = /^[a-f0-9]{40}$/;
  const page = location.origin + location.pathname;
  let app, auth, db, room, ready;

  const reject = (message, code = 409) => Object.assign(new Error(message), {code});
  function setup() {
    if (app) return;
    if (typeof firebase === 'undefined' || typeof firebaseConfig === 'undefined') {
      throw reject('無法載入 Firebase 設定，請確認 firebase-config.js 與 index.html 位於同一個 minefield 資料夾。', 503);
    }
    app = firebase.initializeApp(firebaseConfig, student ? 'minefield-student' : 'minefield-teacher');
    auth = app.auth();
    db = app.database();
  }

  function round(groupCount) {
    const deck = [14, 8, 5, 3, 1].flatMap((count, i) => Array(count).fill(i + 1)).concat(Array(5).fill(0));
    const rng = crypto.getRandomValues(new Uint32Array(deck.length));
    for (let i = deck.length - 1; i > 0; i--) {
      const j = rng[i] % (i + 1);
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return {
      deck,
      state: {
        id: token(), turn: 1, roundNumber: 1, active: 0, locked: true, groupCount,
        scores: Array(groupCount).fill(0),
      },
    };
  }

  function snapshot(state) {
    const cards = Array.from({length:36}, (_, i) => state.reveals?.[i] || null);
    return {
      id: state.id, turn: state.turn, roundNumber: state.roundNumber ?? state.turn, active: state.active, locked: state.locked,
      scores: state.scores, cards, events: cards.filter(Boolean).sort((a,b) => a.turn - b.turn),
      role: student ? team : 'teacher',
    };
  }

  function applyMove(data) {
    const move = data?.move;
    if (!move) return;
    const state = data.state;
    const card = move.card;
    if (move.id === state.id && move.turn === state.turn && move.group === state.active &&
        !state.locked && Number.isInteger(card) && card >= 0 && card < 36 && !state.reveals?.[card]) {
      const value = data.deck[card];
      const before = state.scores[state.active];
      const score = value ? before + value : 0;
      state.reveals ||= {};
      state.reveals[card] = {group:state.active, card, value, before, score, turn:state.turn};
      state.scores[state.active] = score;
      state.locked = true;
    }
    delete data.move;
    return data;
  }

  async function login(email, password) {
    setup();
    const result = await auth.signInWithEmailAndPassword(email, password)
      .catch(() => { throw reject('無法登入。請確認 Firebase 教師帳號和密碼。'); });
    if (result.user.uid !== teacherUid) {
      await auth.signOut();
      throw reject('此帳號沒有教師權限。請使用 Minefield Challenge 的教師帳號。');
    }
    let id = localStorage.getItem(savedRoomKey);
    if (!tokenPattern.test(id)) {
      id = token();
      localStorage.setItem(savedRoomKey, id);
    }
    room = db.ref('minefieldRooms/' + id);
    try {
      const current = await room.once('value');
      if (!current.exists()) {
        const groups = Object.fromEntries(Array.from({length:10}, (_, i) => [i, token()]));
        await room.set({...round(5), codes:groups});
      } else if (!current.child('state/roundNumber').exists()) {
        await room.transaction(data => {
          if (!data?.state || data.state.roundNumber != null) return;
          const state = data.state;
          state.roundNumber = state.turn;
          if (!state.locked) {
            state.locked = true;
            state.turn++;
            delete data.move;
          }
          return data;
        }, undefined, false);
      }
    } catch {
      throw reject('無法開啟牌盤。請確認 Firebase 已發布踩地雷的資料庫規則。');
    }
    room.on('value', current => {
      if (current.child('move').exists()) room.transaction(applyMove, undefined, false).catch(console.error);
    });
  }

  async function join() {
    if (!tokenPattern.test(roomId) || !tokenPattern.test(code) || !params.has('group') ||
        !Number.isInteger(team) || team < 0 || team > 9) {
      throw reject('組別網址不完整，請重新掃描老師提供的 QR Code。', 403);
    }
    setup();
    try {
      const result = await auth.signInAnonymously();
      room = db.ref('minefieldRooms/' + roomId);
      await room.child('members').child(result.user.uid).set({group:team, code});
    } catch {
      throw reject('無法加入。請老師確認已開放此組，並啟用 Firebase 匿名登入。', 403);
    }
  }

  function waitForMove(turn) {
    const stateRef = room.child('state');
    return new Promise((resolve, rejectPromise) => {
      const finish = callback => {
        clearTimeout(timer);
        stateRef.off('value', listener);
        callback();
      };
      const listener = result => {
        const state = result.val();
        if (state && (state.id !== turn.id || state.turn !== turn.turn || state.locked)) {
          finish(() => resolve(snapshot(state)));
        }
      };
      const timer = setTimeout(() => finish(() => rejectPromise(reject('已送出翻牌。請確認教師投影頁在線上。'))), 5000);
      stateRef.on('value', listener, error => finish(() => rejectPromise(error)));
    });
  }

  async function request(path, fields) {
    if (student) {
      if (!ready) ready = join().catch(error => { ready = null; throw error; });
      await ready;
    }
    if (!room) throw reject('請先登入或掃描組別 QR Code。', 403);
    if (path === 'state') {
      try {
        return snapshot((await room.child('state').once('value')).val());
      } catch {
        throw reject('暫時無法讀取牌盤，請確認組別已開放。', 403);
      }
    }
    if (student && path === 'flip') {
      try {
        await room.child('move').set({...fields, group:team});
      } catch {
        throw reject('這張牌已翻開，或這個回合已鎖定。');
      }
      return waitForMove(fields);
    }
    if (student) throw reject('此操作需要教師權限。', 403);
    if (path === 'qr') return minefieldQR(fields.url);
    if (path === 'join') {
      const data = (await room.once('value')).val();
      const keys = Array.from({length:data.state.groupCount}, (_, i) => new URLSearchParams({
        room:room.key, group:String(i), code:data.codes[i],
      }).toString());
      return {origins:[page], keys};
    }
    if (['next', 'reset', 'open', 'pause', 'adjust'].includes(path)) {
      const newRound = path === 'reset' ? round(fields.groups) : null;
      const result = await room.transaction(data => {
        const state = data?.state;
        if (!state || fields.id !== state.id || fields.turn !== state.turn) return;
        if (newRound) {
          delete data.move;
          return {...data, ...newRound};
        }
        if (path === 'adjust') {
          const {group, delta} = fields;
          if (!Number.isInteger(group) || group < 0 || group >= state.groupCount ||
              (delta !== -1 && delta !== 1)) return;
          state.scores[group] = Math.max(0, state.scores[group] + delta);
          return data;
        }
        const revealed = Object.values(state.reveals || {});
        if (revealed.length === 36) return;
        if (path === 'open') {
          if (!state.locked || revealed.some(card => card.turn === state.turn)) return;
          state.locked = false;
        } else if (path === 'pause') {
          if (state.locked) return;
          state.roundNumber ??= state.turn;
          state.turn++;
          state.locked = true;
          delete data.move;
        } else {
          if (!state.locked) return;
          state.active = (state.active + 1) % state.groupCount;
          state.roundNumber = (state.roundNumber ?? state.turn) + 1;
          state.turn++;
        }
        return data;
      }, undefined, false);
      if (!result.committed) throw reject('牌盤已更新，請確認目前回合。');
      return snapshot(result.snapshot.val().state);
    }
    throw reject('找不到操作。', 404);
  }
  return {student, login, request};
}
