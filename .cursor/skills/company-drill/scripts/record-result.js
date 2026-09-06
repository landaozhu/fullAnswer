#!/usr/bin/env node
/**
 * 特训打分：对照 25k 考察列表。
 * 过关（追问后中位数一面能过）→ 对上就打 ✓。
 * 不过关（含第一口对、追问挂了）→ 对上就打 ✗，并把没过的追问写进母题 md；对不上就新建笔记并写入考察列表。
 */
const fs = require('fs');
const path = require('path');
const {
  loadData,
  initOrSyncData,
  markResult,
  syncMarkdownTable,
  saveData,
  classifyImportance,
  getImportanceLabel,
  getPassThreshold,
  isPass25k,
  emptyReviews,
  PROJECT_ROOT,
} = require('../../spaced-review/scripts/lib');
const {
  getArg,
  parseList,
  findListMatch,
  appendFollowUps,
  addAsked,
  loadProgress,
  startSession,
  DOMAIN_TO_DIR,
  slugTitle,
} = require('./lib');

const args = process.argv.slice(2);
const title = getArg(args, 'title');
const scoreArg = getArg(args, 'score');
const domain = getArg(args, 'domain') || 'principle';
const localId = getArg(args, 'id') || getArg(args, 'local-id');
const ask = getArg(args, 'ask') || title;
const failedFollowUps = parseList((getArg(args, 'failed-followups') || '').replace(/\|/g, ','));

if (!title || scoreArg == null) {
  console.error('用法: node record-result.js --title="题" --score=<0-10> [--id=现有id] [--domain=react] [--ask=完整问法] [--failed-followups=追问1,追问2]');
  process.exit(1);
}

const score = Number(scoreArg);
if (Number.isNaN(score) || score < 0 || score > 10) {
  console.error('score 必须是 0～10');
  process.exit(1);
}

let data = loadData();
if (!data) data = initOrSyncData();

const importanceGuess = { handwritten: 'P1', css: 'P2' }[domain] || 'P0';
const passed = isPass25k(score, importanceGuess);
let created = false;
let matched = findListMatch(data, { localId, title, topics: title });

if (!matched && !passed) {
  const dirRel = DOMAIN_TO_DIR[domain] || 'interview/js';
  const rel = `${dirRel}/${slugTitle(title)}.md`;
  const abs = path.join(PROJECT_ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (!fs.existsSync(abs)) {
    const followBlock = failedFollowUps.length
      ? failedFollowUps.map((f) => `- ${f}`).join('\n')
      : '';
    const extra = followBlock ? `\n\n## 追问\n\n${followBlock}\n` : '\n';
    fs.writeFileSync(abs, `# ${title}\n\n## 题\n\n${ask || title}${extra}`, 'utf8');
  }

  const maxOrder = data.questions.reduce((m, x) => Math.max(m, x.order || 0), 0);
  const category = dirRel.split('/')[1] || 'js';
  const base = {
    id: rel,
    title,
    category,
    source: 'interview',
    path: rel,
    learned: null,
    firstLearnedAt: null,
    reviews: emptyReviews(),
    order: maxOrder + 1,
  };
  const importance = classifyImportance(base);
  matched = {
    ...base,
    importance,
    importanceLabel: getImportanceLabel(importance),
    importanceLocked: false,
  };
  data.questions.push(matched);
  saveData(data);
  created = true;
}

if (!matched) {
  if (!loadProgress()) startSession({ company: '特训', round: '一面' });
  try {
    addAsked({
      title, localId: null, domain, source: 'invented', score, passed: true,
    });
  } catch (err) {
    console.error(String(err.message || err));
  }
  console.log(JSON.stringify({
    ok: true,
    action: 'pass-without-list',
    title,
    score,
    passed: true,
    note: '过关且考察列表没有：不写入。',
  }, null, 2));
  process.exit(0);
}

data = loadData() || data;
const marked = markResult(data, matched.id, score);
if (failedFollowUps.length > 0) {
  appendFollowUps(marked.question.path, failedFollowUps);
}
syncMarkdownTable(loadData() || data);

if (!loadProgress()) startSession({ company: '特训', round: '一面' });
try {
  addAsked({
    title,
    localId: marked.question.id,
    domain,
    source: created ? 'invented' : 'local',
    score,
    passed: marked.passed,
  });
} catch (err) {
  console.error(String(err.message || err));
}

console.log(JSON.stringify({
  ok: true,
  created,
  id: marked.question.id,
  title: marked.question.title,
  score: marked.score,
  threshold: marked.threshold || getPassThreshold(marked.question.importance),
  passed: marked.passed,
  learnedLabel: marked.passed ? '✓' : '✗',
  firstLearnedAt: marked.question.firstLearnedAt,
  path: marked.question.path,
  wroteFollowUps: failedFollowUps,
}, null, 2));
