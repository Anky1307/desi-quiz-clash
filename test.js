'use strict';
const assert = require('node:assert/strict');
const { questionBank, makeMatchQuestions, normalizeNickname, uniqueNickname } = require('./game-logic');

assert.equal(questionBank.length, 80, 'question bank must contain 80 questions');
const categories = ['gk', 'cricket', 'bollywood', 'science'];
const expected = { easy: 7, medium: 8, hard: 5 };
for (const category of categories) {
  const qs = questionBank.filter(q => q.category === category);
  assert.equal(qs.length, 20, `${category} must have 20 questions`);
  for (const [difficulty, expectedCount] of Object.entries(expected)) {
    assert.equal(qs.filter(q => q.difficulty === difficulty).length, expectedCount, `${category} difficulty distribution ${difficulty}`);
  }
}
for (const q of questionBank) {
  assert.ok(q.en && q.hi && q.factEn && q.factHi, `question ${q.id} needs bilingual text and explanation`);
  assert.equal(q.options.length, 4, `question ${q.id} must have four options`);
  assert.ok(q.options.every(o => o.en && o.hi && o.key), `question ${q.id} options must be bilingual`);
  assert.equal(q.options.filter(o => o.key === q.correctKey).length, 1, `question ${q.id} must have exactly one correct option`);
}
let previousIds = [];
for (let i = 0; i < 200; i++) {
  const { questions, ids } = makeMatchQuestions(previousIds);
  if (previousIds.length) {
    const previousSet = new Set(previousIds);
    for (const category of categories) {
      for (const difficulty of ['easy', 'medium', 'hard']) {
        const selected = questions.filter(q => q.category === category && q.difficulty === difficulty);
        const freshCount = questionBank.filter(q => q.category === category && q.difficulty === difficulty && !previousSet.has(q.id)).length;
        if (freshCount >= selected.length) {
          assert.ok(selected.every(q => !previousSet.has(q.id)), `should avoid previous-match ${category}/${difficulty} questions when enough are available`);
        }
      }
    }
  }
  previousIds = ids;
  assert.equal(questions.length, 12, 'a match must have 12 questions');
  assert.equal(new Set(questions.map(q => q.id)).size, 12, 'a match must not contain duplicates');
  for (const category of categories) assert.equal(questions.filter(q => q.category === category).length, 3, `${category} must have 3 questions`);
  assert.deepEqual(Object.fromEntries(['easy','medium','hard'].map(d => [d, questions.filter(q => q.difficulty === d).length])), { easy: 4, medium: 5, hard: 3 }, 'difficulty distribution must match approved rules');
  for (const q of questions) assert.equal(q.options.filter(o => o.key === q.correctKey).length, 1, 'shuffled options must retain correct mapping');
}
assert.equal(normalizeNickname('  Cricket   King  '), 'Cricket King');
assert.equal(normalizeNickname('A'), null);
assert.equal(normalizeNickname('Name@123'), null);
assert.equal(normalizeNickname('NicknameTooLongIndeed'), null);
assert.equal(uniqueNickname('King', [{ nickname: 'King', removed: false }]), 'King2');
console.log('All Desi Quiz Clash checks passed: 80 bilingual questions, exact category/difficulty balances, shuffled answer mapping, and nickname validation.');
