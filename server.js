'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { questionBank, makeMatchQuestions, normalizeNickname, uniqueNickname } = require('./game-logic');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  serveClient: true,
  cors: { origin: true, credentials: false },
  pingInterval: 25000,
  pingTimeout: 20000
});

const PORT = Number(process.env.PORT) || 3000;
const rooms = new Map();
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const QUESTION_SECONDS = 15;
const REVEAL_SECONDS = 8;
const GRACE_MS = 60_000;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'desi-quiz-clash', rooms: rooms.size }));

function randomId() { return crypto.randomUUID(); }
function randomCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}
function publicQuestion(question, reveal = false) {
  if (!question) return null;
  const out = {
    id: question.id, category: question.category, difficulty: question.difficulty, en: question.en, hi: question.hi,
    options: question.options.map(o => ({ key: o.key, en: o.en, hi: o.hi }))
  };
  if (reveal) {
    const answer = question.options.find(o => o.key === question.correctKey);
    out.correctKey = question.correctKey;
    out.correctAnswerEn = answer ? answer.en : '';
    out.correctAnswerHi = answer ? answer.hi : '';
    out.factEn = question.factEn;
    out.factHi = question.factHi;
  }
  return out;
}
function findPlayer(room, playerId) { return room.players.find(p => p.pid === playerId && !p.removed); }
function connectedPlayers(room) { return room.players.filter(p => !p.removed && p.connected && p.socketId); }
function sortPlayers(room) {
  if (room.phase === 'lobby') return room.players.filter(p => !p.removed).slice().sort((a, b) => a.joinedAt - b.joinedAt);
  return room.players.filter(p => !p.removed).slice().sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
}
function addRanks(players) {
  let lastScore = null;
  let lastRank = 0;
  return players.map((p, index) => {
    const rank = p.score === lastScore ? lastRank : index + 1;
    lastScore = p.score;
    lastRank = rank;
    return { ...p, rank };
  });
}
function stateFor(room, playerId) {
  const self = findPlayer(room, playerId);
  if (!self) return null;
  const sorted = addRanks(sortPlayers(room).map(p => ({
    id: p.pid,
    nickname: p.nickname,
    score: p.score,
    correct: p.correct,
    wrong: p.wrong,
    unanswered: p.unanswered,
    connected: p.connected,
    isHost: p.pid === room.hostPid,
    isMe: p.pid === self.pid,
    joinedAt: p.joinedAt,
    lastResult: (room.phase === 'reveal' && p.lastResult) ? { ...p.lastResult } : null
  })));
  const state = {
    code: room.code,
    phase: room.phase,
    hostId: room.hostPid,
    me: { id: self.pid, nickname: self.nickname, isHost: self.pid === room.hostPid },
    players: sorted,
    connectedCount: connectedPlayers(room).length,
    playerCount: room.players.filter(p => !p.removed).length,
    canStart: self.pid === room.hostPid && connectedPlayers(room).length >= MIN_PLAYERS && connectedPlayers(room).length <= MAX_PLAYERS && (room.phase === 'lobby' || room.phase === 'results'),
    maxPlayers: MAX_PLAYERS,
    questionNumber: room.questionIndex >= 0 ? room.questionIndex + 1 : 0,
    totalQuestions: 12
  };
  if (room.phase === 'question') {
    state.question = publicQuestion(room.questions[room.questionIndex], false);
    state.questionEndsAt = room.questionEndsAt;
    state.selectedOptionKey = room.currentAnswers.get(self.pid) || null;
  } else if (room.phase === 'reveal') {
    state.question = publicQuestion(room.questions[room.questionIndex], true);
    state.revealEndsAt = room.revealEndsAt;
    state.selectedOptionKey = room.currentAnswers.get(self.pid) || null;
    const result = self.lastResult || {};
    state.myQuestionResult = { selectedKey: result.selectedKey || null, correct: Boolean(result.correct), unanswered: !result.selectedKey };
  } else if (room.phase === 'results') {
    state.history = room.history.map((item, index) => {
      const answer = self.answers[index] || { selectedKey: null, correct: false };
      return {
        number: index + 1,
        question: publicQuestion(item, true),
        selectedKey: answer.selectedKey,
        wasCorrect: Boolean(answer.correct),
        unanswered: !answer.selectedKey
      };
    });
    const finalPlayers = sorted;
    const topScore = finalPlayers.length ? finalPlayers[0].score : 0;
    state.winnerIds = finalPlayers.filter(p => p.score === topScore).map(p => p.id);
    state.winnerNames = finalPlayers.filter(p => p.score === topScore).map(p => p.nickname);
  } else if (room.phase === 'lobby') {
    state.lastQuestionIds = room.previousMatchIds.slice();
  }
  return state;
}
function sendState(room) {
  for (const player of room.players) {
    if (!player.removed && player.connected && player.socketId && io.sockets.sockets.has(player.socketId)) {
      const state = stateFor(room, player.pid);
      if (state) io.to(player.socketId).emit('roomState', state);
    }
  }
}
function ackError(ack, message, code = 'ERROR') {
  if (typeof ack === 'function') ack({ ok: false, code, message });
}
function ackOk(ack, extra = {}) { if (typeof ack === 'function') ack({ ok: true, ...extra }); }
function emitNotice(socket, message, kind = 'info') { socket.emit('notice', { message, kind }); }
function clearTimer(timer) { if (timer) clearTimeout(timer); }
function clearEmptyRoomTimer(room) { clearTimer(room.emptyTimer); room.emptyTimer = null; }
function clearPlayerTimer(player) { clearTimer(player.expiryTimer); player.expiryTimer = null; }
function ensureHost(room) {
  const host = findPlayer(room, room.hostPid);
  if (host && host.connected && !host.removed) return;
  const next = room.players.filter(p => !p.removed && p.connected && p.socketId).sort((a, b) => a.joinedAt - b.joinedAt)[0];
  room.hostPid = next ? next.pid : null;
}
function closeRoom(room, message = 'This room has been closed.') {
  clearTimer(room.questionTimer);
  clearTimer(room.revealTimer);
  clearEmptyRoomTimer(room);
  for (const player of room.players) {
    clearPlayerTimer(player);
    if (player.socketId) {
      const liveSocket = io.sockets.sockets.get(player.socketId);
      if (liveSocket) {
        liveSocket.emit('roomClosed', { message });
        liveSocket.leave(room.code);
        liveSocket.data.roomCode = null;
        liveSocket.data.playerId = null;
      }
    }
  }
  rooms.delete(room.code);
}
function scheduleEmptyRoomClose(room) {
  if (connectedPlayers(room).length > 0) { clearEmptyRoomTimer(room); return; }
  if (room.emptyTimer) return;
  room.emptyTimer = setTimeout(() => {
    room.emptyTimer = null;
    if (rooms.has(room.code) && connectedPlayers(room).length === 0) {
      closeRoom(room, 'Room closed because nobody rejoined within 60 seconds. / 60 सेकंड में कोई वापस नहीं आया, इसलिए रूम बंद हो गया।');
    }
  }, GRACE_MS);
}
function markOffline(room, player, reason = 'disconnect') {
  if (!player || player.removed || !player.connected) return;
  player.connected = false;
  player.socketId = null;
  player.rejoinUntil = Date.now() + GRACE_MS;
  if (room.phase === 'question') room.currentAnswers.delete(player.pid); // missed current question = 0
  if (room.hostPid === player.pid) ensureHost(room);
  clearPlayerTimer(player);
  player.expiryTimer = setTimeout(() => {
    player.expiryTimer = null;
    if (player.connected || player.removed || !rooms.has(room.code)) return;
    player.expired = true;
    if (room.phase === 'lobby') {
      room.players = room.players.filter(p => p.pid !== player.pid);
    }
    // During a match/results, retain the score card until results/rematch; but disallow rejoin.
    if (room.phase === 'results') player.rejoinUntil = 0;
    sendState(room);
  }, GRACE_MS);
  scheduleEmptyRoomClose(room);
  sendState(room);
}
function startQuestion(room) {
  clearTimer(room.questionTimer);
  clearTimer(room.revealTimer);
  if (!rooms.has(room.code)) return;
  if (room.questionIndex >= room.questions.length) {
    room.phase = 'results';
    room.questionEndsAt = null;
    room.revealEndsAt = null;
    sendState(room);
    return;
  }
  room.phase = 'question';
  room.currentAnswers = new Map();
  room.questionEndsAt = Date.now() + QUESTION_SECONDS * 1000;
  room.revealEndsAt = null;
  for (const p of room.players) p.lastResult = null;
  sendState(room);
  room.questionTimer = setTimeout(() => closeCurrentQuestion(room), QUESTION_SECONDS * 1000);
}
function closeCurrentQuestion(room) {
  if (!rooms.has(room.code) || room.phase !== 'question') return;
  clearTimer(room.questionTimer);
  const question = room.questions[room.questionIndex];
  const answerById = new Map();
  for (const player of room.players.filter(p => !p.removed)) {
    // A disconnected player cannot submit after disconnect; no active answer means unanswered.
    const selectedKey = player.connected ? (room.currentAnswers.get(player.pid) || null) : null;
    const correct = Boolean(selectedKey && selectedKey === question.correctKey);
    if (correct) { player.score += 100; player.correct += 1; }
    else if (selectedKey) player.wrong += 1;
    else player.unanswered += 1;
    const record = { questionId: question.id, selectedKey, correct };
    player.answers[room.questionIndex] = record;
    player.lastResult = { selectedKey, correct, unanswered: !selectedKey };
    answerById.set(player.pid, record);
  }
  room.history[room.questionIndex] = question;
  room.phase = 'reveal';
  room.questionEndsAt = null;
  room.revealEndsAt = Date.now() + REVEAL_SECONDS * 1000;
  sendState(room);
  room.revealTimer = setTimeout(() => {
    if (!rooms.has(room.code) || room.phase !== 'reveal') return;
    room.questionIndex += 1;
    if (room.questionIndex >= room.questions.length) {
      room.phase = 'results';
      room.revealEndsAt = null;
      sendState(room);
    } else {
      startQuestion(room);
    }
  }, REVEAL_SECONDS * 1000);
}
function startGame(room, ack) {
  const connected = connectedPlayers(room);
  if (connected.length < MIN_PLAYERS || connected.length > MAX_PLAYERS) {
    ackError(ack, 'At least 2 and at most 8 connected players are needed. / कम से कम 2 और अधिकतम 8 खिलाड़ी जुड़े होने चाहिए।', 'PLAYER_COUNT');
    return;
  }
  // Remove players whose 60-second return window expired before a new match starts.
  room.players = room.players.filter(p => !p.removed && !p.expired);
  if (room.players.length > MAX_PLAYERS) {
    ackError(ack, 'This room has reached the 8-player limit. / इस रूम में 8 खिलाड़ियों की सीमा पूरी हो गई है।', 'ROOM_FULL');
    return;
  }
  const match = makeMatchQuestions(room.previousMatchIds || []);
  for (const p of room.players) {
    p.score = 0; p.correct = 0; p.wrong = 0; p.unanswered = 0; p.answers = []; p.lastResult = null;
  }
  room.questions = match.questions;
  room.previousMatchIds = match.ids;
  room.questionIndex = 0;
  room.history = [];
  room.currentAnswers = new Map();
  room.phase = 'question';
  ackOk(ack);
  startQuestion(room);
}

io.on('connection', socket => {
  socket.data.roomCode = null;
  socket.data.playerId = null;

  socket.on('createRoom', (payload = {}, ack) => {
    if (socket.data.roomCode) return ackError(ack, 'Leave your current room before creating another. / नया रूम बनाने से पहले मौजूदा रूम छोड़ें।', 'ALREADY_IN_ROOM');
    const nickname = normalizeNickname(payload.nickname);
    const clientKey = String(payload.clientKey || '');
    if (!nickname) return ackError(ack, 'Nickname must be 2–16 characters and use letters, numbers or spaces. / निकनेम 2–16 अक्षरों का हो और उसमें अक्षर, नंबर या स्पेस हों।', 'BAD_NICKNAME');
    if (clientKey.length < 16 || clientKey.length > 100) return ackError(ack, 'Could not identify this browser session. Refresh and try again. / ब्राउज़र सेशन नहीं मिला। रिफ्रेश करके दोबारा कोशिश करें।', 'BAD_SESSION');
    const code = randomCode();
    const player = {
      pid: randomId(), clientKey, nickname, socketId: socket.id, connected: true, joinedAt: Date.now(),
      score: 0, correct: 0, wrong: 0, unanswered: 0, answers: [], lastResult: null,
      rejoinUntil: null, expired: false, removed: false, expiryTimer: null
    };
    const room = {
      code, hostPid: player.pid, players: [player], phase: 'lobby', questions: [], questionIndex: -1,
      questionEndsAt: null, revealEndsAt: null, questionTimer: null, revealTimer: null, emptyTimer: null,
      currentAnswers: new Map(), history: [], previousMatchIds: [], kickedClientKeys: new Set()
    };
    rooms.set(code, room);
    socket.data.roomCode = code; socket.data.playerId = player.pid; socket.join(code);
    clearEmptyRoomTimer(room);
    ackOk(ack, { code, nickname });
    sendState(room);
  });

  socket.on('joinRoom', (payload = {}, ack) => {
    const code = String(payload.code || '').trim().toUpperCase();
    const clientKey = String(payload.clientKey || '');
    const requestedNickname = normalizeNickname(payload.nickname);
    if (socket.data.roomCode) return ackError(ack, 'Leave your current room before joining another. / दूसरे रूम में जाने से पहले मौजूदा रूम छोड़ें।', 'ALREADY_IN_ROOM');
    if (!/^[A-Z2-9]{6}$/.test(code)) return ackError(ack, 'Enter the 6-character room code. / 6 अक्षरों वाला रूम कोड डालें।', 'BAD_CODE');
    const room = rooms.get(code);
    if (!room) return ackError(ack, 'Room not found. Ask the host for the current code. / रूम नहीं मिला। होस्ट से नया कोड लें।', 'ROOM_NOT_FOUND');
    if (clientKey.length < 16 || clientKey.length > 100) return ackError(ack, 'Could not identify this browser session. Refresh and try again. / ब्राउज़र सेशन नहीं मिला। रिफ्रेश करके दोबारा कोशिश करें।', 'BAD_SESSION');
    if (room.kickedClientKeys.has(clientKey)) return ackError(ack, 'The host removed this browser from the room. / होस्ट ने इस ब्राउज़र को रूम से हटाया है।', 'KICKED');
    const existing = room.players.find(p => p.clientKey === clientKey && !p.removed);
    if (existing) {
      if (existing.expired || (existing.rejoinUntil && existing.rejoinUntil < Date.now())) {
        return ackError(ack, 'Your 60-second return window has expired. / वापस आने के 60 सेकंड खत्म हो गए।', 'REJOIN_EXPIRED');
      }
      if (requestedNickname && requestedNickname.toLocaleLowerCase() !== existing.nickname.toLocaleLowerCase()) {
        return ackError(ack, `Rejoin with your original nickname: ${existing.nickname}. / अपने पुराने निकनेम ${existing.nickname} से वापस जुड़ें।`, 'NICKNAME_MISMATCH');
      }
      if (existing.connected && existing.socketId && existing.socketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(existing.socketId);
        if (oldSocket) {
          oldSocket.emit('sessionReplaced', { message: 'This room session was reopened in another tab. / यह रूम सेशन दूसरे टैब में खुला है।' });
          oldSocket.leave(code);
          oldSocket.data.roomCode = null; oldSocket.data.playerId = null;
          oldSocket.disconnect(true);
        }
      }
      clearPlayerTimer(existing);
      existing.connected = true; existing.socketId = socket.id; existing.expired = false; existing.rejoinUntil = null;
      if (!room.hostPid) ensureHost(room);
      socket.data.roomCode = code; socket.data.playerId = existing.pid; socket.join(code);
      clearEmptyRoomTimer(room);
      ackOk(ack, { code, nickname: existing.nickname, rejoined: true });
      emitNotice(socket, 'Welcome back! Your score has been restored. / वापस स्वागत है! आपका स्कोर वापस आ गया है।', 'success');
      sendState(room);
      return;
    }
    if (room.phase !== 'lobby') return ackError(ack, 'This match has started. New players can join after the match or rematch lobby opens. / मैच शुरू हो चुका है। नए खिलाड़ी अगले मैच में जुड़ सकते हैं।', 'MATCH_IN_PROGRESS');
    if (!requestedNickname) return ackError(ack, 'Nickname must be 2–16 characters and use letters, numbers or spaces. / निकनेम 2–16 अक्षरों का हो और उसमें अक्षर, नंबर या स्पेस हों।', 'BAD_NICKNAME');
    if (room.players.filter(p => !p.removed).length >= MAX_PLAYERS) return ackError(ack, 'This room is full (8 players). / रूम भर चुका है (8 खिलाड़ी)।', 'ROOM_FULL');
    const nickname = uniqueNickname(requestedNickname, room.players);
    const player = {
      pid: randomId(), clientKey, nickname, socketId: socket.id, connected: true, joinedAt: Date.now(),
      score: 0, correct: 0, wrong: 0, unanswered: 0, answers: [], lastResult: null,
      rejoinUntil: null, expired: false, removed: false, expiryTimer: null
    };
    room.players.push(player);
    if (!room.hostPid) ensureHost(room);
    socket.data.roomCode = code; socket.data.playerId = player.pid; socket.join(code);
    clearEmptyRoomTimer(room);
    ackOk(ack, { code, nickname, rejoined: false });
    if (nickname !== requestedNickname) emitNotice(socket, `Nickname already used; your name is ${nickname}. / यह नाम पहले से था, आपका निकनेम ${nickname} है।`, 'info');
    sendState(room);
  });

  socket.on('startGame', (_payload = {}, ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return ackError(ack, 'Room not found. / रूम नहीं मिला।', 'ROOM_NOT_FOUND');
    if (socket.data.playerId !== room.hostPid) return ackError(ack, 'Only the host can start the quiz. / सिर्फ होस्ट क्विज़ शुरू कर सकता है।', 'NOT_HOST');
    if (!['lobby', 'results'].includes(room.phase)) return ackError(ack, 'The quiz is already running. / क्विज़ पहले से चल रहा है।', 'MATCH_RUNNING');
    startGame(room, ack);
  });

  socket.on('selectAnswer', (payload = {}, ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'question') return ackError(ack, 'This question is closed. / यह सवाल बंद हो चुका है।', 'QUESTION_CLOSED');
    const player = findPlayer(room, socket.data.playerId);
    if (!player || !player.connected || player.socketId !== socket.id) return ackError(ack, 'Reconnect to answer. / जवाब देने के लिए दोबारा जुड़ें।', 'NOT_CONNECTED');
    if (Date.now() >= room.questionEndsAt) return ackError(ack, 'Time is up. / समय समाप्त।', 'TIME_UP');
    const question = room.questions[room.questionIndex];
    const key = String(payload.optionKey || '');
    if (!question.options.some(o => o.key === key)) return ackError(ack, 'Choose one of the four options. / चार विकल्पों में से एक चुनें।', 'BAD_OPTION');
    room.currentAnswers.set(player.pid, key);
    ackOk(ack);
    // A player's selection is sent only to that player; other players cannot see it.
    const state = stateFor(room, player.pid);
    if (state) socket.emit('roomState', state);
  });

  socket.on('kickPlayer', (payload = {}, ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return ackError(ack, 'Room not found. / रूम नहीं मिला।', 'ROOM_NOT_FOUND');
    if (socket.data.playerId !== room.hostPid) return ackError(ack, 'Only the host can remove players. / सिर्फ होस्ट खिलाड़ियों को हटा सकता है।', 'NOT_HOST');
    if (room.phase !== 'lobby') return ackError(ack, 'Players can only be removed before the quiz starts. / खिलाड़ियों को सिर्फ क्विज़ शुरू होने से पहले हटाया जा सकता है।', 'MATCH_RUNNING');
    const target = findPlayer(room, String(payload.playerId || ''));
    if (!target || target.pid === room.hostPid) return ackError(ack, 'Choose another player to remove. / हटाने के लिए दूसरा खिलाड़ी चुनें।', 'BAD_TARGET');
    target.removed = true; room.kickedClientKeys.add(target.clientKey); clearPlayerTimer(target);
    if (target.socketId) {
      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket) {
        targetSocket.emit('kicked', { message: 'The host removed you from this lobby. / होस्ट ने आपको लॉबी से हटा दिया।' });
        targetSocket.leave(room.code); targetSocket.data.roomCode = null; targetSocket.data.playerId = null;
      }
    }
    room.players = room.players.filter(p => p.pid !== target.pid);
    ackOk(ack);
    sendState(room);
  });

  socket.on('leaveRoom', (_payload = {}, ack) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room ? findPlayer(room, socket.data.playerId) : null;
    if (!room || !player) {
      socket.data.roomCode = null; socket.data.playerId = null;
      return ackOk(ack);
    }
    socket.leave(room.code);
    socket.data.roomCode = null; socket.data.playerId = null;
    markOffline(room, player, 'voluntary leave');
    ackOk(ack);
  });

  socket.on('closeRoom', (_payload = {}, ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return ackError(ack, 'Room not found. / रूम नहीं मिला।', 'ROOM_NOT_FOUND');
    if (socket.data.playerId !== room.hostPid) return ackError(ack, 'Only the host can close the room. / सिर्फ होस्ट रूम बंद कर सकता है।', 'NOT_HOST');
    if (!['lobby', 'results'].includes(room.phase)) return ackError(ack, 'You can close the room from the lobby or results screen, not during a match. / रूम सिर्फ लॉबी या रिज़ल्ट स्क्रीन से बंद हो सकता है।', 'MATCH_RUNNING');
    ackOk(ack);
    closeRoom(room, 'The host closed this room. / होस्ट ने रूम बंद कर दिया।');
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const pid = socket.data.playerId;
    if (!code || !pid) return;
    const room = rooms.get(code);
    if (!room) return;
    const player = findPlayer(room, pid);
    // If this was a replaced tab, don't mark the new connection offline.
    if (player && player.socketId === socket.id) markOffline(room, player, 'disconnect');
  });
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Desi Quiz Clash listening on http://0.0.0.0:${PORT}`);
    console.log(`Question bank: ${questionBank.length} questions.`);
  });
}

module.exports = { app, server, rooms, questionBank, makeMatchQuestions, normalizeNickname, uniqueNickname };
