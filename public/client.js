'use strict';

const appRoot = document.getElementById('app');
const toastRegion = document.getElementById('toast-region');
const socket = io({ reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 800, reconnectionDelayMax: 5000, timeout: 10000 });

function makeClientKey() {
  try {
    let key = localStorage.getItem('dqc-client-key');
    if (!key) {
      key = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `dqc-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem('dqc-client-key', key);
    }
    return key;
  } catch (_e) {
    return `dqc-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
}
const clientKey = makeClientKey();
let savedSession = getSavedSession();
let currentState = null;
let socketReady = false;
let pending = false;
let clockInterval = null;
let lastReconnectAttempt = 0;

function getSavedSession() {
  try {
    const parsed = JSON.parse(localStorage.getItem('dqc-active-session') || 'null');
    return parsed && parsed.code && parsed.nickname ? parsed : null;
  } catch (_e) { return null; }
}
function saveSession(code, nickname) {
  savedSession = { code, nickname, clientKey };
  try { localStorage.setItem('dqc-active-session', JSON.stringify(savedSession)); } catch (_e) {}
}
function clearSession() {
  savedSession = null;
  try { localStorage.removeItem('dqc-active-session'); } catch (_e) {}
}
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
function catLabel(category) {
  return ({ gk: '🇮🇳 Indian GK', cricket: '🏏 Cricket', bollywood: '🎬 Bollywood', science: '🔬 Science' })[category] || category;
}
function diffLabel(difficulty) {
  return ({ easy: 'EASY', medium: 'MEDIUM', hard: 'HARD' })[difficulty] || difficulty;
}
function plural(count, singular, pluralForm = `${singular}s`) { return `${count} ${count === 1 ? singular : pluralForm}`; }
function rankLabel(rank) { return rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : `${rank}th`; }

function toast(message, kind = 'info') {
  const item = document.createElement('div');
  item.className = `toast ${kind}`;
  item.textContent = message;
  toastRegion.appendChild(item);
  window.setTimeout(() => { item.style.opacity = '0'; item.style.transform = 'translateY(6px)'; window.setTimeout(() => item.remove(), 220); }, 3600);
}
function action(eventName, payload = {}) {
  if (!socket.connected) { toast('Connection is offline. Reconnecting… / कनेक्शन फिर से जुड़ रहा है।', 'error'); return; }
  if (pending) return;
  pending = true;
  render();
  socket.emit(eventName, payload, response => {
    pending = false;
    if (!response || !response.ok) {
      toast(response?.message || 'Something went wrong. Please try again. / कुछ गड़बड़ हुई, फिर से कोशिश करें।', 'error');
      if (['ROOM_NOT_FOUND', 'REJOIN_EXPIRED', 'KICKED'].includes(response?.code)) {
        clearSession(); currentState = null; render();
      } else if (currentState) render();
      else renderHome();
      return;
    }
    if (response.code && response.nickname) saveSession(response.code, response.nickname);
    render();
  });
}
function copyText(value) {
  const text = String(value || '');
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('Room code copied! / रूम कोड कॉपी हो गया।', 'success')).catch(() => fallbackCopy(text));
  } else fallbackCopy(text);
}
function fallbackCopy(text) {
  const input = document.createElement('textarea'); input.value = text; input.style.position = 'fixed'; input.style.opacity = '0'; document.body.appendChild(input); input.select();
  try { document.execCommand('copy'); toast('Room code copied! / रूम कोड कॉपी हो गया।', 'success'); } catch (_e) { toast(`Room code: ${text}`, 'info'); }
  input.remove();
}
function loadingMarkup(text = 'Connecting to the room…') {
  return `<div class="loading-state"><div class="loader"></div><p>${escapeHTML(text)}</p></div>`;
}
function renderHome() {
  if (!socket.connected) {
    appRoot.innerHTML = `${homeMarkup()}<div class="notice-banner" style="margin-top:16px"><span>◌</span> Reconnecting to the game server… / गेम सर्वर से दोबारा जुड़ रहे हैं।</div>`;
    return;
  }
  appRoot.innerHTML = homeMarkup();
}
function homeMarkup() {
  const lastNickname = savedSession?.nickname || '';
  return `
    <section class="home-grid">
      <div class="hero-copy">
        <div class="eyebrow">Your friends. Your bragging rights.</div>
        <h1>Game night,<br><span class="accent">desi style.</span></h1>
        <p class="lead">A fast, funny, bilingual quiz clash across Indian GK, cricket, Bollywood and science. Grab your gang, enter a code and let the brain battle begin.</p>
        <div class="hero-badges">
          <span class="pill"><i class="pill-dot"></i> Live multiplayer</span>
          <span class="pill">No account needed</span>
          <span class="pill">Hindi + English</span>
        </div>
        <div class="topics-row">
          <div class="topic-tile"><span class="topic-icon">🇮🇳</span><span class="topic-title">Indian GK</span></div>
          <div class="topic-tile"><span class="topic-icon">🏏</span><span class="topic-title">Cricket</span></div>
          <div class="topic-tile"><span class="topic-icon">🎬</span><span class="topic-title">Bollywood</span></div>
          <div class="topic-tile"><span class="topic-icon">🔬</span><span class="topic-title">Science</span></div>
        </div>
      </div>
      <section class="home-card">
        <div class="card-heading">
          <div><div class="eyebrow">Jump into the clash</div><h2>Ready, player?</h2><p>Create a room for your gang or join with a friend's code.<br>अपनी टीम के साथ खेल शुरू करें।</p></div>
          <div class="mini-stamp">⚡</div>
        </div>
        <form id="home-form" autocomplete="off">
          <div class="field"><label for="nickname-input">YOUR NICKNAME / आपका निकनेम</label><input id="nickname-input" name="nickname" maxlength="32" placeholder="e.g. CricketKing" value="${escapeHTML(lastNickname)}" required /></div>
          <div class="two-actions">
            <button class="btn btn-primary" type="button" data-action="create-room" ${pending || !socket.connected ? 'disabled' : ''}>✦ Create a room</button>
            <button class="btn btn-secondary" type="button" data-action="toggle-join" aria-expanded="false">Join with code ↗</button>
          </div>
          <div id="join-fields" class="hidden">
            <div class="field"><label for="room-code-input">ROOM CODE / रूम कोड</label><input id="room-code-input" name="roomCode" maxlength="6" placeholder="K7M2PX" autocapitalize="characters" spellcheck="false" /></div>
            <button class="btn btn-secondary" type="button" data-action="join-room" style="width:100%" ${pending || !socket.connected ? 'disabled' : ''}>Join the clash →</button>
          </div>
          <p class="form-help">12 questions · 15 seconds each · 100 points per correct answer. No downloads, no sign-up—just share the room code.</p>
        </form>
        <div class="connection-note"><span class="live-dot" style="background:${socket.connected ? 'var(--mint)' : 'var(--red)'}"></span><span>${socket.connected ? 'Game server connected' : 'Connecting to game server'} · Secure room codes · 2–8 players</span></div>
      </section>
    </section>`;
}
function playersListMarkup(state, allowKick) {
  return state.players.map(player => {
    const isLeader = player.score === Math.max(0, ...state.players.map(p => p.score));
    const kick = allowKick && state.me.isHost && !player.isMe ? `<button class="btn btn-danger btn-small" data-action="kick-player" data-player-id="${escapeHTML(player.id)}" aria-label="Remove ${escapeHTML(player.nickname)}">Remove</button>` : '';
    return `<div class="player-row ${player.isMe ? 'is-me' : ''}">
      <div class="avatar">${escapeHTML([...player.nickname][0]?.toUpperCase() || '?')}</div>
      <div class="player-meta"><div class="player-name">${player.isHost ? '👑 ' : ''}${escapeHTML(player.nickname)}${player.isMe ? ' <span class="role-chip">YOU</span>' : ''}${player.isHost ? ' <span class="role-chip">HOST</span>' : ''}</div>
      <div class="player-sub">${player.connected ? (player.isHost ? 'Room host / रूम होस्ट' : 'Ready to play / खेलने के लिए तैयार') : 'Reconnecting… / वापस जुड़ रहे हैं'}</div></div>
      <span class="status-pill ${player.connected ? 'online' : ''}">${player.connected ? 'Online' : 'Offline'}</span>${kick}
    </div>`;
  }).join('');
}
function roomCodeMarkup(code) {
  return `<div class="room-code-box"><div><div class="room-code-label">Share this room code / कोड शेयर करें</div></div><div class="room-code-value">${escapeHTML(code)} <button class="icon-button" data-action="copy-code" data-code="${escapeHTML(code)}" aria-label="Copy room code" title="Copy room code">▢</button></div></div>`;
}
function rulesMarkup() {
  return `<div class="rule-list">
    <div class="rule-line"><span>Match length / कुल सवाल</span><b>12 questions</b></div>
    <div class="rule-line"><span>Question timer / समय</span><b>15 seconds</b></div>
    <div class="rule-line"><span>Scoring / अंक</span><b>+100 · wrong = 0</b></div>
    <div class="rule-line"><span>Categories / विषय</span><b>3 each · 4 topics</b></div>
    <div class="rule-line"><span>Difficulty / स्तर</span><b>4 easy · 5 medium · 3 hard</b></div>
    <div class="rule-line"><span>Reveal / उत्तर दिखाना</span><b>8 seconds</b></div>
  </div>`;
}
function renderLobby(state) {
  const full = state.playerCount >= 8;
  const canStart = state.me.isHost && state.connectedCount >= 2 && state.connectedCount <= 8;
  appRoot.innerHTML = `
    <div class="screen-header"><div><div class="eyebrow">Room lobby / खिलाड़ियों का कमरा</div><h2>Assemble your gang.</h2><p>Share the code, wait for your friends, then hit Start Quiz.</p></div>${roomCodeMarkup(state.code)}</div>
    <div class="lobby-grid">
      <section class="panel">
        <div class="panel-top"><h3>Players in the room</h3><span class="count-chip">${state.connectedCount}/${state.maxPlayers} online</span></div>
        <div class="player-list">${playersListMarkup(state, true)}</div>
        <div class="invite-box"><div><strong>Invite your squad / दोस्तों को बुलाएँ</strong><span>${full ? 'Room is full. / रूम भर गया है।' : 'Up to 8 players · No accounts needed'}</span></div><button class="btn btn-secondary btn-small" data-action="copy-code" data-code="${escapeHTML(state.code)}">Copy code</button></div>
        <div class="lobby-actions">
          ${state.me.isHost ? `<button class="btn btn-primary" data-action="start-game" ${canStart && !pending ? '' : 'disabled'}>▶ Start Quiz</button>` : `<div class="btn btn-secondary" style="flex:1;cursor:default">Waiting for host to start… / होस्ट का इंतज़ार करें</div>`}
          <button class="btn btn-quiet" data-action="leave-room" ${pending ? 'disabled' : ''}>Leave room</button>
          ${state.me.isHost ? `<button class="btn btn-quiet" data-action="close-room" ${pending ? 'disabled' : ''}>Close room</button>` : ''}
        </div>
        ${state.me.isHost && state.connectedCount < 2 ? `<p class="form-help">You need at least one more connected player before starting. / शुरू करने के लिए कम से कम एक और खिलाड़ी चाहिए।</p>` : ''}
      </section>
      <aside class="panel"><div class="panel-top"><h3>Clash rules</h3><span class="count-chip">Quick guide</span></div>${rulesMarkup()}<p class="form-help">Answers stay private during the timer. Correct answers, fun facts and the leaderboard appear together after each question. / टाइमर के दौरान जवाब निजी रहेंगे।</p></aside>
    </div>`;
}
function leaderboardMarkup(state, compact = false) {
  const players = state.players;
  const top = players.length ? Math.max(...players.map(p => p.score)) : 0;
  return `<div class="score-list">${players.map(p => {
    const leader = p.score === top;
    return `<div class="score-row"><span class="score-rank">${p.rank ? `#${p.rank}` : '—'}</span><span class="score-nick ${leader ? 'leader' : ''}" title="${escapeHTML(p.nickname)}">${leader ? '👑 ' : ''}${escapeHTML(p.nickname)}${p.isMe ? ' (you)' : ''}${!p.connected ? ' · offline' : ''}</span><span class="score-value">${p.score}</span></div>`;
  }).join('')}</div>${compact ? '' : `<p class="score-note">Highest score wears the crown. Tied scores share a rank. / सबसे ज़्यादा अंक वाले खिलाड़ी को क्राउन मिलता है।</p>`}`;
}
function questionTopline(state, endsAt, duration, reveal = false) {
  const seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  const progress = Math.max(0, Math.min(100, seconds / duration * 100));
  return `<div class="game-topline"><div class="progress-copy"><b>QUESTION ${state.questionNumber}</b> <span>of ${state.totalQuestions}</span></div><div class="progress-track"><div class="progress-fill" id="progress-fill" style="width:${progress}%"></div></div><div class="timer-chip ${seconds <= 5 ? 'urgent' : ''}" id="timer-chip"><span class="timer-icon">◷</span><span class="timer-number" id="timer-number">${seconds}s</span></div></div>`;
}
function questionCardMarkup(state, question) {
  const selected = state.selectedOptionKey;
  const seconds = Math.max(0, Math.ceil((state.questionEndsAt - Date.now()) / 1000));
  return `${questionTopline(state, state.questionEndsAt, 15)}
    <section class="question-card">
      <div class="question-meta"><span class="category-chip">${catLabel(question.category)}</span><span class="difficulty-chip ${question.difficulty}">${diffLabel(question.difficulty)}</span><span class="question-number">QUESTION ${state.questionNumber} / 12</span></div>
      <h2 class="question-title">${escapeHTML(question.en)}</h2><p class="question-hindi" lang="hi">${escapeHTML(question.hi)}</p>
      <div class="answer-grid">${question.options.map((option, index) => `<button class="answer-option ${selected === option.key ? 'selected' : ''}" data-action="select-answer" data-option-key="${escapeHTML(option.key)}" ${seconds <= 0 || pending ? 'disabled' : ''} aria-pressed="${selected === option.key}"><span class="option-letter">${String.fromCharCode(65 + index)}</span><span class="option-copy"><span class="option-en">${escapeHTML(option.en)}</span><span class="option-hi" lang="hi">${escapeHTML(option.hi)}</span></span></button>`).join('')}</div>
      <div class="answer-footer"><span>${selected ? '<strong>Answer selected / जवाब चुना गया</strong>' : '<strong>Choose your answer / अपना जवाब चुनें</strong>'}</span><span>${selected ? 'You can still change it before time runs out. / समय खत्म होने तक बदल सकते हैं।' : 'Answers are private until the timer ends. / आपके जवाब निजी हैं।'}</span></div>
    </section>`;
}
function renderQuestion(state) {
  appRoot.innerHTML = `<div class="screen-header"><div><div class="eyebrow">The clash is live / मुकाबला शुरू</div><h2>Trust your brain.</h2><p>Choose an option. You can change your mind until the timer ends.</p></div><div class="count-chip">Your score <b style="color:var(--saffron);margin-left:5px">${state.players.find(p => p.isMe)?.score ?? 0}</b></div></div>
    <div class="game-layout"><div class="game-main">${questionCardMarkup(state, state.question)}</div><aside class="side-panel"><section class="panel score-panel"><div class="panel-top"><h3>Live leaderboard</h3><span class="count-chip">Round ${state.questionNumber}</span></div>${leaderboardMarkup(state)} </section><section class="panel"><div class="panel-top"><h3>Keep it fair</h3></div><p class="muted" style="font-size:12px;line-height:1.7;margin:0">Answers remain private until time runs out. Correct answer + a fun fact appear for everyone after the round. / जवाब टाइमर के बाद दिखेंगे।</p></section></aside></div>`;
}
function revealMarkup(state) {
  const question = state.question;
  const myResult = state.myQuestionResult || {};
  const selected = question.options.find(o => o.key === myResult.selectedKey);
  const seconds = Math.max(0, Math.ceil((state.revealEndsAt - Date.now()) / 1000));
  return `${questionTopline(state, state.revealEndsAt, 8, true)}
    <section class="question-card reveal-card">
      <div class="reveal-status"><span class="status-check">✓</span> ANSWER REVEALED / जवाब सामने है</div>
      <div class="question-meta" style="margin-top:16px"><span class="category-chip">${catLabel(question.category)}</span><span class="difficulty-chip ${question.difficulty}">${diffLabel(question.difficulty)}</span></div>
      <h2 class="question-title">${escapeHTML(question.en)}</h2><p class="question-hindi" lang="hi">${escapeHTML(question.hi)}</p>
      <div class="correct-answer-box"><div class="correct-answer-label">Correct answer / सही जवाब</div><div class="correct-answer-en">${escapeHTML(question.correctAnswerEn)}</div><div class="correct-answer-hi" lang="hi">${escapeHTML(question.correctAnswerHi)}</div></div>
      <div class="fact-box"><p>${escapeHTML(question.factEn)}</p><p lang="hi">${escapeHTML(question.factHi)}</p></div>
      <div class="reveal-bottom"><span>${myResult.correct ? '✅ You got it! +100 points / सही जवाब! +100 अंक' : myResult.unanswered ? '⏱ No answer · 0 points / जवाब नहीं · 0 अंक' : '↗ Not this time · 0 points / इस बार नहीं · 0 अंक'}</span><span class="reveal-timer" id="timer-number">Next in ${seconds}s</span></div>
    </section>`;
}
function renderReveal(state) {
  appRoot.innerHTML = `<div class="screen-header"><div><div class="eyebrow">Round ${state.questionNumber} complete</div><h2>Answer check.</h2><p>Catch the fact, check the scores, then the next question begins automatically.</p></div><div class="count-chip">+100 for correct</div></div>
    <div class="game-layout"><div class="game-main">${revealMarkup(state)}</div><aside class="side-panel"><section class="panel score-panel"><div class="panel-top"><h3>Updated leaderboard</h3><span class="count-chip">Live scores</span></div>${leaderboardMarkup(state)}</section></aside></div>`;
}
function reviewMarkup(state, item) {
  const q = item.question;
  const selectedOption = q.options.find(o => o.key === item.selectedKey);
  const resultBadge = item.wasCorrect ? '✅' : item.unanswered ? '⏱' : '✕';
  return `<details class="review-item"><summary class="review-toggle"><span class="review-index">${item.number}</span><span class="review-summary"><b>${escapeHTML(q.en)}</b><small>${escapeHTML(catLabel(q.category))} · ${diffLabel(q.difficulty)} · ${item.wasCorrect ? 'Correct · +100' : item.unanswered ? 'Unanswered · 0' : 'Incorrect · 0'}</small></span><span class="review-state">${resultBadge}</span></summary>
    <div class="review-details"><p class="question-hindi" lang="hi">${escapeHTML(q.hi)}</p>
      ${q.options.map((o, i) => `<div class="review-option ${o.key === q.correctKey ? 'good' : ''} ${item.selectedKey === o.key && !item.wasCorrect ? 'mine-wrong' : ''}"><b>${String.fromCharCode(65 + i)}</b><span class="review-option-text"><span>${escapeHTML(o.en)}${o.key === q.correctKey ? ' ✓' : item.selectedKey === o.key ? ' · Your answer' : ''}</span><small lang="hi">${escapeHTML(o.hi)}</small></span></div>`).join('')}
      <div class="fact-box"><p><strong>Fact:</strong> ${escapeHTML(q.factEn)}</p><p lang="hi"><strong>जानकारी:</strong> ${escapeHTML(q.factHi)}</p></div>
      ${selectedOption ? `<p class="form-help">Your answer / आपका जवाब: <strong>${escapeHTML(selectedOption.en)}</strong> — ${item.wasCorrect ? 'Correct' : 'Incorrect'}</p>` : `<p class="form-help">You did not answer this question. / आपने इस सवाल का जवाब नहीं दिया।</p>`}
    </div></details>`;
}
function renderResults(state) {
  const my = state.players.find(p => p.isMe) || { score: 0, correct: 0, wrong: 0, unanswered: 0 };
  const winners = state.winnerNames || [];
  const title = winners.length > 1 ? 'Joint champions!' : (winners.length === 1 && winners[0] === state.me.nickname ? 'You are the champion!' : `${winners[0] || 'The gang'} wins the clash!`);
  const winnerLine = winners.length > 1 ? `🏆 ${winners.join(' · ')}` : `🏆 ${winners[0] || 'No winner'}`;
  appRoot.innerHTML = `<div class="results-hero"><div class="winner-emblem">🏆</div><div class="eyebrow">That’s a wrap / मुकाबला खत्म</div><h2>${escapeHTML(title)}</h2><p>${escapeHTML(winnerLine)} · Match complete · 1,200 points max</p></div>
    <div class="results-grid"><div class="panel"><div class="panel-top"><h3>Final leaderboard</h3><span class="count-chip">12 questions</span></div>
      ${state.players.map(p => `<div class="final-score-row"><span class="rank-big ${p.rank === 1 ? 'gold' : ''}">${p.rank === 1 ? '👑' : `#${p.rank}`}</span><div class="final-score-copy"><div class="final-score-name">${escapeHTML(p.nickname)}${p.isMe ? ' (you)' : ''}</div><div class="final-score-sub">${p.correct} correct · ${p.wrong} wrong · ${p.unanswered} unanswered</div></div><div class="final-points">${p.score}</div></div>`).join('')}
      <div class="result-stat-grid"><div class="stat-tile"><strong>${my.correct}</strong><span>Correct</span></div><div class="stat-tile"><strong>${my.wrong}</strong><span>Wrong</span></div><div class="stat-tile"><strong>${my.unanswered}</strong><span>Skipped</span></div></div>
      <div class="results-actions">${state.me.isHost ? `<button class="btn btn-primary" data-action="start-game" ${state.connectedCount >= 2 && !pending ? '' : 'disabled'}>↻ Play Again</button>` : `<div class="btn btn-secondary" style="flex:1;cursor:default">Waiting for host to play again…</div>`}<button class="btn btn-quiet" data-action="leave-room" ${pending ? 'disabled' : ''}>Leave room</button>${state.me.isHost ? `<button class="btn btn-quiet" data-action="close-room" ${pending ? 'disabled' : ''}>Close room</button>` : ''}</div>
      ${state.me.isHost && state.connectedCount < 2 ? '<p class="form-help">At least 2 connected players are needed for a rematch. / रीमैच के लिए कम से कम 2 खिलाड़ी चाहिए।</p>' : ''}
    </div><section class="panel"><div class="panel-top"><h3>Answer review</h3><span class="count-chip">All 12 questions</span></div><p class="form-help" style="margin-top:0;margin-bottom:16px">Open a question to review the correct answer and the bilingual fact. / सही जवाब और जानकारी देखने के लिए सवाल खोलें।</p><div class="review-list">${state.history.map(item => reviewMarkup(state, item)).join('')}</div></section></div>`;
}
function render() {
  if (!currentState) { renderHome(); return; }
  if (currentState.phase === 'lobby') renderLobby(currentState);
  else if (currentState.phase === 'question') renderQuestion(currentState);
  else if (currentState.phase === 'reveal') renderReveal(currentState);
  else if (currentState.phase === 'results') renderResults(currentState);
  else renderHome();
  updateClock();
}
function updateClock() {
  if (!currentState || !['question', 'reveal'].includes(currentState.phase)) return;
  const endsAt = currentState.phase === 'question' ? currentState.questionEndsAt : currentState.revealEndsAt;
  const duration = currentState.phase === 'question' ? 15 : 8;
  const seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  const timer = document.getElementById('timer-number');
  if (timer) timer.textContent = currentState.phase === 'question' ? `${seconds}s` : `Next in ${seconds}s`;
  const chip = document.getElementById('timer-chip');
  if (chip) chip.classList.toggle('urgent', seconds <= 5);
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, seconds / duration * 100))}%`;
  if (currentState.phase === 'question' && seconds <= 0) {
    document.querySelectorAll('[data-action="select-answer"]').forEach(button => { button.disabled = true; });
  }
}

appRoot.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const task = button.dataset.action;
  if (task === 'toggle-join') {
    const panel = document.getElementById('join-fields');
    const show = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !show);
    button.setAttribute('aria-expanded', String(show));
    if (show) document.getElementById('room-code-input')?.focus();
  } else if (task === 'create-room') {
    const nickname = document.getElementById('nickname-input')?.value || '';
    action('createRoom', { nickname, clientKey });
  } else if (task === 'join-room') {
    const nickname = document.getElementById('nickname-input')?.value || '';
    const code = document.getElementById('room-code-input')?.value || '';
    action('joinRoom', { nickname, code: code.toUpperCase().replace(/\s/g, ''), clientKey });
  } else if (task === 'copy-code') {
    copyText(button.dataset.code || currentState?.code);
  } else if (task === 'start-game') {
    action('startGame', {});
  } else if (task === 'leave-room') {
    socket.emit('leaveRoom', {}, response => {
      pending = false;
      if (response && !response.ok) toast(response.message || 'Could not leave room.', 'error');
      clearSession(); currentState = null; renderHome();
    });
  } else if (task === 'close-room') {
    if (window.confirm('Close this room for everyone? / सभी के लिए रूम बंद करें?')) action('closeRoom', {});
  } else if (task === 'kick-player') {
    const nickname = currentState?.players.find(p => p.id === button.dataset.playerId)?.nickname || 'this player';
    if (window.confirm(`Remove ${nickname} from the lobby? / ${nickname} को लॉबी से हटाएँ?`)) action('kickPlayer', { playerId: button.dataset.playerId });
  } else if (task === 'select-answer') {
    if (!currentState || currentState.phase !== 'question' || Date.now() >= currentState.questionEndsAt) return;
    const optionKey = button.dataset.optionKey;
    currentState.selectedOptionKey = optionKey;
    // Optimistically show the newest choice; the server separately validates and persists it.
    render();
    socket.emit('selectAnswer', { optionKey }, response => {
      if (!response || !response.ok) toast(response?.message || 'Answer could not be saved.', 'error');
    });
  }
});
appRoot.addEventListener('submit', event => event.preventDefault());

socket.on('connect', () => {
  socketReady = true;
  if (savedSession && Date.now() - lastReconnectAttempt > 800) {
    lastReconnectAttempt = Date.now();
    socket.emit('joinRoom', { code: savedSession.code, nickname: savedSession.nickname, clientKey }, response => {
      if (response?.ok) saveSession(response.code, response.nickname);
      else if (response?.code === 'ROOM_NOT_FOUND' || response?.code === 'REJOIN_EXPIRED' || response?.code === 'KICKED') {
        clearSession(); currentState = null; renderHome();
        if (response?.code !== 'ROOM_NOT_FOUND') toast(response.message, 'info');
      } else if (response && !response.ok) {
        // During a refresh, the previous socket may still be releasing its slot; retry once.
        toast(response.message || 'Could not restore the room session.', 'error');
        if (!currentState) renderHome();
      }
    });
  } else if (!currentState) renderHome();
  else render();
});
socket.on('disconnect', () => {
  socketReady = false;
  if (currentState) {
    toast('Connection lost. Trying to reconnect… / कनेक्शन टूट गया, फिर जुड़ रहे हैं।', 'error');
  } else renderHome();
});
socket.on('connect_error', () => {
  if (!currentState) renderHome();
});
socket.on('roomState', state => {
  currentState = state;
  if (state.code && state.me?.nickname) saveSession(state.code, state.me.nickname);
  render();
});
socket.on('notice', notice => toast(notice.message || '', notice.kind || 'info'));
socket.on('kicked', data => {
  clearSession(); currentState = null; renderHome(); toast(data?.message || 'You were removed from the room.', 'error');
});
socket.on('roomClosed', data => {
  clearSession(); currentState = null; renderHome(); toast(data?.message || 'Room closed.', 'info');
});
socket.on('sessionReplaced', data => {
  currentState = null; renderHome(); toast(data?.message || 'Room session moved to another tab.', 'info');
});

if (clockInterval) clearInterval(clockInterval);
clockInterval = setInterval(updateClock, 150);
renderHome();
