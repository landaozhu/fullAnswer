---
name: agent-quiz
description: >-
  每天自测 Agent 面试题 3 道（原理 / LangChain / Python 尽量各 1），25k 达标线。
  只出 Python、LangChain、Agent/RAG 理解题；禁止 LangGraph。
  达标打 ✓ 写首次学会；未达标打 ✗ 清空日期。
  打 ✓ 须追问后确认中位数一面能过；半截答案 / 追问空白不能打 ✓。
  抽题三类混抽：到期 25% · 未学会 25% · 未测 50%。
  当用户说 Agent自测、agent面试、langchain抽查、每天agent、agent 3题、agent 面试考我 时使用。
---

# Agent 自测（每天 3 题 · 25k）

只考 `interview/agent/`。每次 **3 题**，尽量 **原理 1 + LangChain 1 + Python 1**。某桶当天抽空则从其余桶补齐。

候选人目标：**上海 25k**。按理解题答：能对比、能说清使用边界，不要求手写框架源码。

**禁止出 LangGraph**（未学）。多步状态图、checkpoint、节点/边不要考、也不要当成标准答案。

## 抽题

```bash
node .cursor/skills/agent-quiz/scripts/pick-session.js
```

读 `questions[].path`。不要把文件或后续题目提前给候选人。

抽题三类混抽：到期 25% · 未学会 25% · 未测 50%。  
**当天已经做过的题（达标或未达标）当天绝不再抽。**  
**已打「不再提问」的题永不抽。**

## 及格线（与 25k 考察列表相同）

P0 / P1 ≥ **6**；P2 / P3 ≥ **5**。打 ✓ 见 [`spaced-review/scoring.md`](../spaced-review/scoring.md)：必须追问；追问后关键机制能补上才算 6。

写回同一张 `25k考察列表`。Agent 题不进入前端「自我考察 / 一面模拟」抽题池。

## Agent 流程

### 1. 抽 3 题 → 只公布规则 → 出第 1 题

开场只说：今天 **3 题**（原理 / LangChain / Python），25k 理解题。然后立刻问第 1 题。

### 2. 每题：回答 → 追问 → 打分 0～10

每题 **必须** 1～2 个中位数追问（追问不算 3 题里的题）。可看该 md 的「追问」作参考，不要先把答案读出来。  
第一口不完整时禁止直接打 ✓。追问后机制说不清 → 最高 5，打 ✗。

### 3. 立刻写回

```bash
node .cursor/skills/agent-quiz/scripts/mark-question.js "<question.id>" --score=<得分>
```

告知本机：

```
📊 得分：7/10（及格线 6）
✅ 已打 ✓ · 首次学会 2026-09-02 · R0→R1
```
或
```
📊 得分：3/10（及格线 6）
🔴 已打 ✗ · 未学会（无日期记录）
```

然后出下一题，直到 3 题结束。

### 4. 汇总

- 逐题得分（标 原理 / LangChain / Python）
- 平均分、及格数 / 3
- 弱项下一句：哪桶没过，指出对应笔记路径即可

用户说「这题不再提问」：

```bash
node .cursor/skills/spaced-review/scripts/mark-result.js --retire "<id>"
```

## 禁止

- ❌ 出 LangGraph / StateGraph / checkpoint
- ❌ 一次把 3 道题都抛给候选人
- ❌ 先贴答案或把 md 全文读出来
- ❌ 不带分数打钩
- ❌ 未达标打 ✓
- ❌ 没追问就打 ✓（第一口不完整时）
- ❌ 追问不会 / 空白仍打 ✓
- ❌ 打 ✗ 仍写首次学会或 R 列
- ❌ 当天已做过的题再抽
