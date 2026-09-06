const fs = require('fs');
const path = require('path');
const { parseComponyMarkdown, normalizeTitle, isAlgoOrDs, isCodeTitle } = require('./parse-compony');
const { resolveInterviewTitle } = require('./question-utils');
const { classifyImportance, getImportanceWeight, getImportanceLabel, RESUME_PROFILE } = require('./importance');
const { shouldExcludeQuestion, isAgentTrack } = require('./question-filters');
const { parseInterviewSummary } = require('./parse-interview-summary');
const { parseNowcoderPosts } = require('./parse-nowcoder');

const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
const DATA_FILE = path.join(PROJECT_ROOT, '25k考察列表.json');
const TABLE_MD = path.join(PROJECT_ROOT, '25k考察列表.md');

/** 遗忘曲线复习节点（间隔天数；到期 = 上一节点日期 + daysAfterPrev） */
const REVIEW_STAGES = [
  { id: 'r0', label: 'R0 初识', daysAfterPrev: 0 },
  { id: 'r1', label: 'R1 复习', daysAfterPrev: 1 },
  { id: 'r2', label: 'R2 复习', daysAfterPrev: 2 },
  { id: 'r3', label: 'R3 复习', daysAfterPrev: 4 },
  { id: 'r4', label: 'R4 复习', daysAfterPrev: 7 },
  { id: 'r5', label: 'R5 复习', daysAfterPrev: 15 },
  { id: 'r6', label: 'R6 复习', daysAfterPrev: 30 },
];

const EXCLUDE = /(README|readme|CHANGELOG|面试记录|promise1\.md$|\/code\/|this\/README)/i;
const INTERVIEW_EXCLUDE_DIRS = new Set(['algorithm', 'dataStructure', 'code', 'node_modules']);
const NOWCODER_DETAIL = path.join(PROJECT_ROOT, '.scraper/nowcoder/posts-detail.json');

const SKIP_FILES = new Set([
  'css.md', 'js.md', 'vue.md', 'html.md', '浏览器.md', 'redux.md', '网络安全.md',
  '前端面试题汇总（超全、附答案链接、持续更新中）.md',
  'react高频面试题.md', 'http高频面试题.md', '高频CSS面试题.md',
  '高频设计模式面试题（js）.md', '高频数据结构面试题（js）.md', '高频算法面试题（js）.md',
]);

/** interview 文件名级算法题剔除 */
const INTERVIEW_ALGO_TITLE_RE =
  /排序|快排|动态规划|二叉|链表|栈|队列|堆|查找|递归|击鼓传花|随机验证码|和为[nm]|数组顺序打乱/i;

/** 三类抽题比例：到期复习 / ✗ 未学会 / 未测（空池时按剩余比例分配）
 * 未测高于到期：避免只会已过题、真实面试大量未覆盖。 */
const PICK_RATIOS = { due: 0.25, notLearned: 0.25, untested: 0.50 };

/** 25k 一面达标分数线（按重要程度） */
const PASS_SCORE_25K = { P0: 6, P1: 6, P2: 5, P3: 5 };

function getPassThreshold(importance) {
  return PASS_SCORE_25K[importance] ?? 6;
}

function isPass25k(score, importance) {
  return score >= getPassThreshold(importance);
}

function migrateLearnedFields(prev) {
  let learned = prev?.learned ?? null;
  if (learned === null && prev?.reviews?.r0) learned = 'yes';

  let firstLearnedAt = null;
  if (learned === 'yes') {
    firstLearnedAt = prev?.firstLearnedAt ?? prev?.firstStudy ?? prev?.reviews?.r0 ?? null;
  }

  return { learned, firstLearnedAt };
}

function wasAttemptedToday(q, today = todayStr()) {
  if (!q) return false;
  if (q.lastAttemptedAt === today) return true;
  if (q.forgottenAt === today) return true;
  return false;
}

function isRetired(q) {
  return Boolean(q && q.retired);
}

function excludeAttemptedToday(pool, today = todayStr()) {
  return pool.filter((d) => !wasAttemptedToday(d.question, today));
}

function excludeRetired(pool) {
  return pool.filter((d) => !isRetired(d.question));
}

/** 纠正非法状态：✗/未测 不得有首次学会或 R 列日期 */
function sanitizeQuestionState(q) {
  if (q.learned === 'yes') {
    delete q.sprintAt;
    if (!q.firstLearnedAt) {
      q.learned = null;
      q.reviews = emptyReviews();
    }
    return;
  }

  if (q.learned === 'no') {
    q.firstLearnedAt = null;
    q.reviews = emptyReviews();
    delete q.sprintAt;
    return;
  }

  q.learned = null;
  q.firstLearnedAt = null;
  delete q.sprintAt;
  q.reviews = emptyReviews();
}

function migratePickRatios(ratios) {
  if (!ratios) return { ...PICK_RATIOS };
  if (ratios.notLearned != null) {
    return {
      due: ratios.due ?? PICK_RATIOS.due,
      notLearned: ratios.notLearned,
      untested: ratios.untested ?? PICK_RATIOS.untested,
    };
  }
  if (ratios.sprint != null) {
    return {
      due: ratios.due ?? PICK_RATIOS.due,
      notLearned: ratios.sprint,
      untested: ratios.untested ?? PICK_RATIOS.untested,
    };
  }
  return { ...PICK_RATIOS };
}

function sanitizeData(data) {
  for (const q of data.questions) sanitizeQuestionState(q);
  data.pickRatios = migratePickRatios(data.pickRatios);
  delete data.sprintPickRatio;
  return data;
}

function formatLearned(q) {
  if (q.learned === 'yes') return '✓';
  if (q.learned === 'no') return '✗';
  return '';
}

/** 池内按重要程度加权；✗ 与未测同等，不做额外优先 */
function getLearnedPickWeight(q) {
  if (q.learned === 'yes') return 1;
  return 1;
}

function getItemPickWeight(d) {
  const impW = getImportanceWeight(d.question.importance);
  const learnedW = getLearnedPickWeight(d.question);
  const dueBoost = d.overdueDays >= 0 ? 1 + d.overdueDays * 2 : 0.3;
  return impW * learnedW * dueBoost;
}

function pickWeightedFromPool(pool) {
  if (pool.length === 0) return null;
  const weights = pool.map(getItemPickWeight);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function getNotLearnedQuestions(data) {
  return data.questions
    .filter((q) => q.learned === 'no' && !isRetired(q))
    .map((q) => ({
      question: q,
      stageId: null,
      stageLabel: '未学会 ✗',
      dueDate: null,
      overdueDays: 0,
      pickSource: 'notLearned',
    }));
}

function getUntestedQuestions(data) {
  return data.questions
    .filter((q) => q.learned !== 'yes' && q.learned !== 'no' && !isRetired(q))
    .map((q) => ({
      question: q,
      stageId: null,
      stageLabel: '未测',
      dueDate: null,
      overdueDays: 0,
      pickSource: 'untested',
    }));
}

function pickWithBalancedRatio(due, notLearned, untested, ratios = PICK_RATIOS) {
  const resolved = migratePickRatios(ratios);
  const pools = [
    { name: 'due', items: due, ratio: resolved.due },
    { name: 'notLearned', items: notLearned, ratio: resolved.notLearned },
    { name: 'untested', items: untested, ratio: resolved.untested },
  ].filter((p) => p.items.length > 0);

  if (pools.length === 0) return { picked: null, pickSource: null };

  const totalRatio = pools.reduce((sum, p) => sum + p.ratio, 0);
  let r = Math.random() * totalRatio;
  let chosen = pools[0];
  for (const p of pools) {
    r -= p.ratio;
    if (r <= 0) {
      chosen = p;
      break;
    }
  }

  return { picked: pickWeightedFromPool(chosen.items), pickSource: chosen.name };
}

/** @deprecated 使用 pickWithBalancedRatio */
function pickWithLearnedPriority(due, notLearned) {
  return pickWithBalancedRatio(due, notLearned, []);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(`${str}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(dateStr, days) {
  const d = parseDate(dateStr);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromStr, toStr) {
  const a = parseDate(fromStr);
  const b = parseDate(toStr);
  if (!a || !b) return Infinity;
  return Math.floor((b - a) / 86400000);
}

function normKey(title) {
  return normalizeTitle(title).toLowerCase().replace(/\s+/g, '');
}

function slugify(text) {
  return normalizeTitle(text)
    .replace(/[\\/:*?"<>|]/g, '')
    .slice(0, 60);
}

function extractInterviewLink(text) {
  const m = text.match(/\]\((?:\.\.\/)?(interview\/[^)]+\.md)\)/i);
  return m ? m[1] : null;
}

function scanInterviewQuestions() {
  const root = path.join(PROJECT_ROOT, 'interview');
  const list = [];

  function walk(dir, categoryParts) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      const rel = path.relative(PROJECT_ROOT, p).replace(/\\/g, '/');
      if (f.isDirectory()) {
        if (INTERVIEW_EXCLUDE_DIRS.has(f.name)) continue;
        if (categoryParts.includes('优化') || categoryParts.includes('场景题')) continue;
        walk(p, [...categoryParts, f.name]);
        continue;
      }
      if (!/\.md$/i.test(f.name) || EXCLUDE.test(rel) || SKIP_FILES.has(f.name)) continue;

      const fileTitle = f.name.replace(/\.md$/i, '');
      if (INTERVIEW_ALGO_TITLE_RE.test(fileTitle) || isAlgoOrDs(fileTitle) || isCodeTitle(fileTitle)) continue;

      const title = resolveInterviewTitle(rel, fileTitle);
      const item = {
        title,
        category: categoryParts[0] || 'interview',
        path: rel,
        source: 'interview',
      };
      if (shouldExcludeQuestion(item)) continue;

      list.push(item);
    }
  }

  if (fs.existsSync(root)) walk(root, []);
  return list;
}

function scanComponyQuestions() {
  const root = path.join(PROJECT_ROOT, 'compony');
  const list = [];
  if (!fs.existsSync(root)) return list;

  function walk(dir) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      const rel = path.relative(PROJECT_ROOT, p).replace(/\\/g, '/');
      if (f.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.md$/i.test(f.name)) continue;
      const content = fs.readFileSync(p, 'utf8');
      list.push(...parseComponyMarkdown(rel, content));
    }
  }

  walk(root);
  return list;
}

function dedupeQuestions(items) {
  const seen = new Map();
  const result = [];

  for (const item of items) {
    if (isCodeTitle(item.title)) continue;
    if (shouldExcludeQuestion(item)) continue;

    const linked = item.raw ? extractInterviewLink(item.raw) : extractInterviewLink(item.title);
    if (linked) continue;

    const key = normKey(item.title);
    if (seen.has(key)) continue;

    const dup = [...seen.values()].some((prev) => {
      const a = key;
      const b = normKey(prev.title);
      return a.length >= 6 && b.length >= 6 && (a.includes(b) || b.includes(a));
    });
    if (dup) continue;

    seen.set(key, item);
    result.push(item);
  }

  return result;
}

function scanNowcoderQuestions() {
  if (!fs.existsSync(NOWCODER_DETAIL)) return [];
  const data = JSON.parse(fs.readFileSync(NOWCODER_DETAIL, 'utf8'));
  return parseNowcoderPosts(data.posts || []);
}

function scanProjectQuestions() {
  const interview = scanInterviewQuestions();
  const compony = scanComponyQuestions();
  const summary = parseInterviewSummary(PROJECT_ROOT);
  const nowcoder = scanNowcoderQuestions();

  const merged = dedupeQuestions([...interview, ...compony, ...summary, ...nowcoder]).map((item) => {
    let id;
    if (item.source === 'compony') {
      id = `${item.path}::${slugify(item.title)}`;
    } else if (item.source === '牛客网面经') {
      id = `${item.path}::${slugify(item.title)}`;
    } else if (item.source === '面试题汇总') {
      id = `summary::${slugify(item.title)}`;
    } else {
      id = item.path;
    }
    return { ...item, id };
  });

  return merged.sort(
    (a, b) =>
      a.source.localeCompare(b.source)
      || a.title.localeCompare(b.title, 'zh-CN'),
  );
}

function legacyQuestionId(title, category) {
  return `${category}::${title}`;
}

function emptyReviews() {
  const reviews = {};
  for (const s of REVIEW_STAGES) reviews[s.id] = null;
  return reviews;
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return null;
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return sanitizeData(data);
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function initOrSyncData() {
  const scanned = scanProjectQuestions();
  const existing = loadData();
  const oldMap = new Map();
  for (const q of existing?.questions || []) {
    oldMap.set(q.id, q);
    oldMap.set(legacyQuestionId(q.title, q.category), q);
    if (q.path && !q.id.includes('::')) oldMap.set(q.path, q);
  }

  const questions = scanned.map((item, index) => {
    const prev =
      oldMap.get(item.id)
      || oldMap.get(item.path)
      || oldMap.get(legacyQuestionId(item.title, item.category));

    const learnedFields = migrateLearnedFields(prev);

    const base = {
      id: item.id,
      title: item.title,
      category: item.category,
      source: item.source,
      path: item.path,
      learned: learnedFields.learned,
      firstLearnedAt: learnedFields.firstLearnedAt,
      reviews: prev?.reviews ?? emptyReviews(),
      order: index + 1,
    };

    const importance =
      prev?.importanceLocked && prev?.importance
        ? prev.importance
        : classifyImportance(base);

    const question = {
      ...base,
      importance,
      importanceLabel: getImportanceLabel(importance),
      importanceLocked: prev?.importanceLocked ?? false,
    };
    if (prev?.lastAttemptedAt) question.lastAttemptedAt = prev.lastAttemptedAt;
    if (prev?.retired) {
      question.retired = true;
      if (prev.retiredAt) question.retiredAt = prev.retiredAt;
    }
    sanitizeQuestionState(question);
    return question;
  });

  const scannedIds = new Set(questions.map((q) => q.id));
  let extraOrder = questions.length;
  for (const prev of existing?.questions || []) {
    if (!prev.retired || scannedIds.has(prev.id)) continue;
    extraOrder += 1;
    questions.push({ ...prev, order: extraOrder });
    scannedIds.add(prev.id);
  }

  const data = {
    version: 4,
    profile: RESUME_PROFILE,
    updatedAt: todayStr(),
    pickRatios: PICK_RATIOS,
    passScore25k: PASS_SCORE_25K,
    reviewStages: REVIEW_STAGES.map(({ id, label, daysAfterPrev }) => ({ id, label, daysAfterPrev })),
    questions,
  };
  saveData(data);
  return data;
}

function getCurrentStage(question) {
  for (const stage of REVIEW_STAGES) {
    if (!question.reviews[stage.id]) return stage.id;
  }
  return null;
}

function getPrevPassDate(question, stageId) {
  const idx = REVIEW_STAGES.findIndex((s) => s.id === stageId);
  if (idx <= 0) return question.firstLearnedAt;
  return question.reviews[REVIEW_STAGES[idx - 1].id];
}

function isStageDue(question, stageId, today = todayStr()) {
  if (question.learned !== 'yes' || !question.firstLearnedAt) return false;

  const stage = REVIEW_STAGES.find((s) => s.id === stageId);
  if (!stage) return false;
  if (question.reviews[stageId]) return false;

  if (stageId === 'r0') {
    return !question.reviews.r0;
  }

  const prevDate = getPrevPassDate(question, stageId);
  if (!prevDate) return false;

  const dueDate = addDays(prevDate, stage.daysAfterPrev);
  return today >= dueDate;
}

function getStageDueDate(question, stageId) {
  if (question.learned !== 'yes' || !question.firstLearnedAt) return null;
  const stage = REVIEW_STAGES.find((s) => s.id === stageId);
  if (!stage || question.reviews[stageId]) return null;

  if (stageId === 'r0') return question.firstLearnedAt;

  const prevDate = getPrevPassDate(question, stageId);
  if (!prevDate) return null;
  return addDays(prevDate, stage.daysAfterPrev);
}

function getDueQuestions(data, today = todayStr()) {
  return data.questions
    .filter((q) => q.learned === 'yes' && q.firstLearnedAt && !isRetired(q))
    .map((q) => {
      const stageId = getCurrentStage(q);
      if (!stageId || !isStageDue(q, stageId, today)) return null;

      const stage = REVIEW_STAGES.find((s) => s.id === stageId);
      const dueDate = getStageDueDate(q, stageId);
      const overdueDays = dueDate ? Math.max(0, daysBetween(dueDate, today)) : 0;

      return { question: q, stageId, stageLabel: stage.label, dueDate, overdueDays };
    })
    .filter(Boolean);
}

function filterPoolsByImportance(due, notLearned, untested, minImportance) {
  if (!minImportance) return { due, notLearned, untested };

  const levelOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const maxOrder = levelOrder[minImportance];
  const filterByMin = (pool) => {
    const filtered = pool.filter((d) => (levelOrder[d.question.importance] ?? 2) <= maxOrder);
    return filtered.length > 0 ? filtered : pool;
  };

  return {
    due: filterByMin(due),
    notLearned: filterByMin(notLearned),
    untested: filterByMin(untested),
  };
}

function pickRandomDue(data, today = todayStr(), options = {}) {
  let due = getDueQuestions(data, today);
  let notLearned = getNotLearnedQuestions(data);
  let untested = getUntestedQuestions(data);

  ({ due, notLearned, untested } = filterPoolsByImportance(
    due, notLearned, untested, options.minImportance,
  ));

  due = excludeAttemptedToday(due, today);
  notLearned = excludeAttemptedToday(notLearned, today);
  untested = excludeAttemptedToday(untested, today);

  const keepFrontend = (d) => !isAgentTrack(d.question);
  due = due.filter(keepFrontend);
  notLearned = notLearned.filter(keepFrontend);
  untested = untested.filter(keepFrontend);

  const { picked, pickSource } = pickWithBalancedRatio(
    due, notLearned, untested, data.pickRatios,
  );
  return { due, notLearned, untested, picked, pickSource };
}

function markPass(data, questionId, date = todayStr()) {
  return markResult(data, questionId, 10, date);
}

function markResult(data, questionId, score, date = todayStr()) {
  const q = data.questions.find((x) => x.id === questionId);
  if (!q) throw new Error(`题目不存在: ${questionId}`);

  const threshold = getPassThreshold(q.importance);
  const passed = isPass25k(score, q.importance);

  if (passed) {
    q.learned = 'yes';
    if (!q.firstLearnedAt) q.firstLearnedAt = date;
    q.lastAttemptedAt = date;
    delete q.sprintAt;

    const stageId = getCurrentStage(q);
    if (stageId) q.reviews[stageId] = date;

    data.updatedAt = date;
    saveData(data);
    return {
      question: q,
      passed: true,
      learned: 'yes',
      score,
      threshold,
      stageId: stageId || null,
      nextStage: getCurrentStage(q),
      date,
    };
  }

  q.learned = 'no';
  q.firstLearnedAt = null;
  q.reviews = emptyReviews();
  q.lastAttemptedAt = date;
  delete q.sprintAt;
  data.updatedAt = date;
  saveData(data);
  return {
    question: q,
    passed: false,
    learned: 'no',
    score,
    threshold,
    date,
  };
}

function ensureQuestionForRetire(data, questionId) {
  const existing = data.questions.find((x) => x.id === questionId);
  if (existing) return existing;

  const isReadingJs = /^interview\/阅读代码题\/.+\.js$/i.test(questionId);
  const abs = path.join(PROJECT_ROOT, questionId);
  if (!isReadingJs || !fs.existsSync(abs)) {
    throw new Error(`题目不存在: ${questionId}`);
  }

  const maxOrder = data.questions.reduce((m, x) => Math.max(m, x.order || 0), 0);
  const q = {
    id: questionId,
    title: path.basename(questionId, '.js'),
    category: '阅读代码题',
    source: '阅读代码题',
    path: questionId,
    learned: null,
    firstLearnedAt: null,
    reviews: emptyReviews(),
    order: maxOrder + 1,
    importance: 'P1',
    importanceLabel: 'P1 高频',
    importanceLocked: false,
  };
  data.questions.push(q);
  return q;
}

function markRetired(data, questionId, date = todayStr()) {
  const q = ensureQuestionForRetire(data, questionId);
  q.retired = true;
  q.retiredAt = date;
  data.updatedAt = date;
  saveData(data);
  return { question: q, retired: true, date };
}

function formatReviewDate(date) {
  return date || '';
}

function escapeMdCell(text) {
  return String(text ?? '').replace(/\|/g, '\\|');
}

function syncMarkdownTable(data) {
  const stages = data.reviewStages;
  const header = ['#', '题目', '是否学会', '不再提问', '重要程度', '来源', '首次学会', ...stages.map((s) => s.label)];
  const sep = header.map((_, i) => (i < 7 ? '---' : ':---:'));
  const rows = data.questions.map((q) => [
    String(q.order),
    escapeMdCell(q.title),
    formatLearned(q),
    q.retired ? '✓' : '',
    q.importanceLabel || q.importance || '',
    q.source,
    q.firstLearnedAt || '',
    ...stages.map((s) => formatReviewDate(q.reviews[s.id])),
  ]);

  const due = getDueQuestions(data);
  const notLearned = getNotLearnedQuestions(data);
  const untested = getUntestedQuestions(data);
  const dueByStage = {};
  const dueByImportance = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const d of due) {
    dueByStage[d.stageLabel] = (dueByStage[d.stageLabel] || 0) + 1;
    const imp = d.question.importance || 'P2';
    dueByImportance[imp] = (dueByImportance[imp] || 0) + 1;
  }

  const learnedStats = data.questions.reduce(
    (acc, q) => {
      if (q.learned === 'yes') acc.yes += 1;
      else if (q.learned === 'no') acc.no += 1;
      else acc.blank += 1;
      return acc;
    },
    { yes: 0, no: 0, blank: 0 },
  );

  const impCounts = data.questions.reduce((acc, q) => {
    acc[q.importance] = (acc[q.importance] || 0) + 1;
    return acc;
  }, {});

  const interviewCount = data.questions.filter((q) => q.source === 'interview').length;
  const componyCount = data.questions.filter((q) => q.source === 'compony').length;
  const nowcoderCount = data.questions.filter((q) => q.source === '牛客网面经').length;
  const summaryCount = data.questions.filter((q) => q.source === '面试题汇总').length;
  const retiredCount = data.questions.filter(isRetired).length;
  const md = `# 25k考察列表

> 题目来源：\`interview/\`（${interviewCount}）· \`compony/\`（${componyCount}）· 牛客网面经（${nowcoderCount}）· 面试题汇总（${summaryCount}）= **${data.questions.length}** 道  
> 画像：**兰为鹏 · 6年经验前端（上海）** · 按 **简历 + 2026 趋势** 标注重要程度  
> 简历未写的内容（如 CI/CD、Monorepo、NestJS、埋点）已降级为 P3  
> 分级：P0 必考 ${impCounts.P0 || 0} · P1 高频 ${impCounts.P1 || 0} · P2 了解 ${impCounts.P2 || 0} · P3 冷门 ${impCounts.P3 || 0}  
> 学会状态：✓ 已学会 ${learnedStats.yes} · ✗ 未学会 ${learnedStats.no} · 未测 ${learnedStats.blank} · 不再提问 ${retiredCount}  
> 数据文件：[\`25k考察列表.json\`](./25k考察列表.json)  
> 最后更新：${data.updatedAt}

## 使用方式

1. 说 **「自我考察」** 或 **「模拟面试」**
2. 说 **「自我考察 P2」** — 可指定最低档位
3. **25k 达标** → 是否学会 **✓**，「首次学会」写入日期，**从该日起**算遗忘曲线。打 ✓ 须追问后确认中位数一面能过；半截答案 / 追问空白不算过
4. **未达标** → **✗** 未学会，**清空**首次学会与 R 列，**不进入**遗忘曲线
5. **未测**（空）→ 不参与遗忘曲线
6. 说 **「这题不再提问」** → 打钩后不再出现在表的抽题范围（不会因为通过/没过自动打）
7. 更新题库：\`node .cursor/skills/spaced-review/scripts/init-questions.js\`

## 是否学会说明

| 标记 | 含义 |
|------|------|
| **✓** | 25k 达标（追问后中位数一面能过）；「首次学会」= 锚点日期（如 2026-08-26） |
| **✗** | 考过未达标 / 同步标记；**无**首次学会/R 列；**不参与**遗忘曲线 |
| **（空）** | 未测 |

「不再提问」列打 ✓ = 你主动说毕业了，抽题/模拟面试都跳过。通过或没过都**不会**自动打这钩。

## 遗忘曲线（仅 ✓ 已学会）

**前提**：是否学会 = ✓ 且「首次学会」有日期，才参与复习调度。

| 节点 | 间隔 | 到期日计算 | 列中显示 |
|------|------|------------|----------|
| R0 初识 | 当天 | = 首次学会 | 复习通过日期 |
| R1 复习 | +1 天 | R0 日期 + 1 天 | 复习通过日期 |
| R2 复习 | +2 天 | R1 日期 + 2 天 | 复习通过日期 |
| R3 复习 | +4 天 | R2 日期 + 4 天 | 复习通过日期 |
| R4 复习 | +7 天 | R3 日期 + 7 天 | 复习通过日期 |
| R5 复习 | +15 天 | R4 日期 + 15 天 | 复习通过日期 |
| R6 复习 | +30 天 | R5 日期 + 30 天 | 复习通过日期 |

R 列显示**实际日期**（如 \`2026-08-27\`），空白 = 该节点尚未复习通过。

**示例**：首次学会 \`2026-08-26\` → R0=\`2026-08-26\` → R1 到期 \`2026-08-27\` → 复习通过后 R1 列写入 \`2026-08-27\`

## 25k 达标分数线

| 等级 | 及格分 |
|------|--------|
| P0 / P1 | ≥ 6 |
| P2 / P3 | ≥ 5 |

**6 分必须是追问之后的分。** 第一口只答一部分、或追问补不回关键机制 → 不算过，打 ✗。不要求把笔记背完，不抠中位数面试官不会问的冷门细节。细则：[\`.cursor/skills/spaced-review/scoring.md\`](./.cursor/skills/spaced-review/scoring.md)

## 重要程度说明（兰为鹏简历 · 2026）

| 等级 | 含义 | 抽题权重 |
|------|------|----------|
| P0 必考 | Webpack、微前端、Vue3/React、SSR、灰度、性能、网络缓存、Event Loop | ×10 |
| P1 高频 | CSS 布局、手写题、TS 基础、Egg/Koa | ×5 |
| P2 了解 | Vite 单独原理、一般考点、面经补充 | ×1.5 |
| P3 冷门 | **CI/CD、Monorepo、NestJS、埋点**、过时考点 | ×0.25 |

## 遗忘曲线节点（见上文说明，R 列存日期）

## 今日概览

- **待复习（✓ 且到期）**：${due.length} 道（P0 ${dueByImportance.P0} · P1 ${dueByImportance.P1} · P2 ${dueByImportance.P2} · P3 ${dueByImportance.P3}）
- **未学会 ✗**：${notLearned.length} 道
- **未测（空）**：${untested.length} 道
- **不再提问**：${retiredCount} 道
${Object.entries(dueByStage).map(([k, v]) => `- ${k} 到期：${v} 道`).join('\n') || '- 暂无到期复习 🎉'}

## 题目进度表

| ${header.join(' | ')} |
| ${sep.join(' | ')} |
${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}
`;

  fs.writeFileSync(TABLE_MD, md, 'utf8');
}

module.exports = {
  PROJECT_ROOT,
  DATA_FILE,
  TABLE_MD,
  REVIEW_STAGES,
  PICK_RATIOS,
  PASS_SCORE_25K,
  todayStr,
  scanProjectQuestions,
  initOrSyncData,
  loadData,
  saveData,
  getDueQuestions,
  getNotLearnedQuestions,
  getUntestedQuestions,
  wasAttemptedToday,
  isRetired,
  excludeAttemptedToday,
  excludeRetired,
  pickWithBalancedRatio,
  sanitizeData,
  sanitizeQuestionState,
  emptyReviews,
  getStageDueDate,
  pickRandomDue,
  pickWithLearnedPriority,
  pickWeightedFromPool,
  getLearnedPickWeight,
  getPassThreshold,
  isPass25k,
  formatLearned,
  markPass,
  markResult,
  markRetired,
  syncMarkdownTable,
  getCurrentStage,
  classifyImportance,
  getImportanceWeight,
  getImportanceLabel,
};
