---
name: company-drill
description: >-
  按目标公司或 JD 做无限补差特训：定档后搜面经，对照弱项按优先级一直出题，不限题库、不限题量，不走 25/25/50 混抽。
  答完对照 25k 考察列表：追问后中位数一面能过且能对上则打 ✓；不过关（含追问挂了）必须把题目或追问写入列表（没有就新建笔记并入表）。
  默认一面且必须穿插手写；用户说二面再切。
  当用户说特训、公司特训、针对xx准备、冲刺xx、给了JD、面经特训、明天面xx 时使用。
---

# 公司 / JD 特训（无限补差）

候选人：**兰为鹏 · 上海 · 6 年前端 · 25k**。出题**不看考察列表有没有**。答完再对照列表：不过关的题目或追问必须写进 `25k考察列表`。

## 硬规则

- **不限题量、不限题库。** 没有「本场 13 题」。
- **不理** 25/25/50 混抽。优先级 = 公司/JD 命中 × 弱项缺口 × 时间性价比。
- 用户没说几面 → **默认一面**，且必须穿插手写。
- 说了「二面 / 三面」才切轮次，见 [company-tiers.md](company-tiers.md)。

## 答完写入考察列表（每次必做）

打分后跑：

```bash
node .cursor/skills/company-drill/scripts/record-result.js --title="题干" --score=<0-10> --domain=react [--id=已有id] [--ask=完整问法] [--failed-followups=追问1,追问2]
```

| 回答 | 考察列表 | 动作 |
|------|----------|------|
| 过关（主干对 **且** 中位数追问能答） | 有对应母题 | 打 ✓，写首次学会 / R |
| 过关 | 没有 | 不写入 |
| **不过关**（含：第一口对、追问挂了） | 有对应母题 | 打 ✗，清空日期；没过的追问写进该母题 md |
| **不过关** | 没有 | 新建 `interview/{方向}/题名.md`，写入 JSON 和 `25k考察列表.md`，打 ✗ |

打 ✓ 细则见 [`spaced-review/scoring.md`](../spaced-review/scoring.md)。**禁止**「母题过了、追问没过、母题仍保持 ✓」。

`--id` 能对上就带上。对不上不要编 id，让脚本建新题。

只改特训和考察列表，**不要改一面模拟 skill**。一面本来就抽这张表（含 ✗ / 未测）。

## 启动

```bash
node .cursor/skills/company-drill/scripts/analyze-gaps.js --boost=vue,react,performance,ts,engineering,handwritten
node .cursor/skills/company-drill/scripts/match-topics.js --topics=xss,typescript,fiber
node .cursor/skills/company-drill/scripts/session.js --start --company=知乎 --tier=content --round=一面 --jd=Vue,TS,XSS
```

`--boost` 按该公司/JD。档位见 [company-tiers.md](company-tiers.md)。有公司名就搜面经；只给 JD 用薪资+年限+栈定档。

## 组队列

题库没有（如 Taro/UniApp）**照样出**。本地笔记只当判分参考，先不要念答案。

开场只说：哪家/JD、几面、今晚补哪几**块**、跳过什么。立刻第 1 题。不要把后续题干抛给候选人。

## 一题一题

1. 出当前最高优先级 1 题。第一口之后 **必须** 口述 1～2 个中位数追问；手写给签名+样例，主路径能跑再追 1 个常见边界。
2. 追问后再打分。P0/P1 ≥ **6**，P2/P3 ≥ **5**；追问挂了 → 最高 5，打 ✗。手写没写出能跑的代码 → ≤4。不抠冷门细节。
3. 立刻 `record-result.js`。告知是否已写入考察列表。
4. **不要停。** 用户说「够了 / 停」才收。

一面节奏：**每 3～4 道口述插 1 道手写**。

## 禁止

- ❌ 因为考察列表没有就不出题
- ❌ 不过关却不写入 25k 考察列表
- ❌ 过关且列表没有时硬塞进表
- ❌ 用 25/25/50 混抽出题
- ❌ 去改一面模拟 / 自我考察 skill
- ❌ 默认一面却不出代码题
- ❌ 一次把后续题干都抛出来
- ❌ 未达标打 ✓；不带分数打钩
- ❌ 没追问就打 ✓（第一口不完整时）
- ❌ 追问不会仍打 ✓（含「母题过了追问没过保持 ✓」）
