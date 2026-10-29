'use strict';
const crypto = require('crypto');
const questionBank = require('./questions');
const CATEGORIES = ['gk', 'cricket', 'bollywood', 'science'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
function shuffle(items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function sample(items, count) { return shuffle(items).slice(0, count); }
function normalizeNickname(input) {
  if (typeof input !== 'string') return null;
  const value = input.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const length = [...value].length;
  if (length < 2 || length > 16) return null;
  if (!/^[\p{L}\p{N} ]+$/u.test(value)) return null;
  return value;
}
function uniqueNickname(raw, players) {
  const used = new Set(players.filter(p => !p.removed).map(p => p.nickname.toLocaleLowerCase()));
  if (!used.has(raw.toLocaleLowerCase())) return raw;
  for (let i = 2; i < 10_000; i++) {
    const suffix = String(i);
    const base = [...raw].slice(0, 16 - suffix.length).join('').trimEnd();
    const candidate = `${base}${suffix}`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return `${raw.slice(0, 12)}${crypto.randomInt(10, 99)}`;
}
function categoryQuestionSet() {
  const result = {};
  for (const category of CATEGORIES) {
    result[category] = {};
    for (const difficulty of DIFFICULTIES) {
      result[category][difficulty] = questionBank.filter(q => q.category === category && q.difficulty === difficulty);
    }
  }
  return result;
}
const questionBuckets = categoryQuestionSet();
function chooseDifficultyAllocation() {
  const target = { easy: 4, medium: 5, hard: 3 };
  const allocations = [];
  function recurse(index, remaining) {
    if (index === CATEGORIES.length) return remaining.easy === 0 && remaining.medium === 0 && remaining.hard === 0;
    const category = CATEGORIES[index];
    const combos = [];
    for (let easy = 0; easy <= 3; easy++) {
      for (let medium = 0; medium <= 3 - easy; medium++) {
        const hard = 3 - easy - medium;
        if (easy > remaining.easy || medium > remaining.medium || hard > remaining.hard) continue;
        if (easy > questionBuckets[category].easy.length || medium > questionBuckets[category].medium.length || hard > questionBuckets[category].hard.length) continue;
        combos.push({ easy, medium, hard });
      }
    }
    for (const combo of shuffle(combos)) {
      const next = { easy: remaining.easy - combo.easy, medium: remaining.medium - combo.medium, hard: remaining.hard - combo.hard };
      const remainingSlots = (CATEGORIES.length - index - 1) * 3;
      if (next.easy + next.medium + next.hard !== remainingSlots) continue;
      allocations[index] = combo;
      if (recurse(index + 1, next)) return true;
    }
    return false;
  }
  if (!recurse(0, target)) throw new Error('Could not satisfy the requested category and difficulty distribution.');
  return allocations;
}
function makeMatchQuestions(previousIds = []) {
  const previous = new Set(previousIds);
  const allocation = chooseDifficultyAllocation();
  const chosen = [];
  const matchIds = [];
  for (let i = 0; i < CATEGORIES.length; i++) {
    const category = CATEGORIES[i];
    const alloc = allocation[i];
    for (const difficulty of DIFFICULTIES) {
      const amount = alloc[difficulty];
      if (!amount) continue;
      let pool = questionBuckets[category][difficulty].filter(q => !previous.has(q.id));
      if (pool.length < amount) pool = questionBuckets[category][difficulty];
      const picked = sample(pool, amount);
      for (const source of picked) {
        chosen.push({ ...source, options: shuffle(source.options.map(option => ({ ...option }))) });
        matchIds.push(source.id);
      }
    }
  }
  return { questions: shuffle(chosen), ids: matchIds };
}
module.exports = { questionBank, makeMatchQuestions, normalizeNickname, uniqueNickname, CATEGORIES, DIFFICULTIES };
