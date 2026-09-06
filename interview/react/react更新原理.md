# React 更新原理

25k 一面过关线：能说出 **调度 → 可中断 render → 不可中断 commit**；双缓冲保证 **半成品不上屏**；追问能讲清 **哪一段可中断、优先级插队例子、useLayoutEffect 落在哪一段**。只报「虚拟 DOM + Diff」不够。

配套：`setState.md`（批处理 / 同步异步）、`react原理.md`（key / Diff 复用）、`react18更新了什么.md`（Concurrent / Transition）。本题主干是 **一次更新怎么走完**。

---

## 开口（40 秒，先结论）

React 15 用递归把整棵树走完，一开就不能停，长任务会卡住输入和动画。Fiber 把工作拆成链表上的单元，主线程可以在单元之间让路。

一次更新三步：

1. **调度**：`setState` / `useState` 先记账，按优先级排进任务，不立刻改 DOM
2. **Render（协调）**：在内存里建 `workInProgress` 树，做 Diff，打 effect 标记。**可暂停、可丢弃，不碰真实 DOM**
3. **Commit（提交）**：一次性把标记应用到 DOM。**不可中断**。做完浏览器才 paint

半成品不会先画到页面上：屏幕始终对应 `current` 树，commit 完才把指针切过去。

---

## 1. 为什么要 Fiber

浏览器一帧大约 **16.6ms**。JS 占着主线程，输入、滚动、动画都排不上。

React 15 的 Stack Reconciler 是递归：`diff` 一个大组件树等于一次超长同步函数，中途没法把控制权交回去。

Fiber 把每个组件 / DOM 节点做成一个对象，用 `child` / `sibling` / `return` 串成链表，而不是靠调用栈。工作循环变成：

```text
做一个 Fiber → 看要不要让出主线程 → 继续下一个 / 暂停 / 丢掉重来
```

面试只需要这个结论：**可中断的单位是 Fiber，不是整棵树。** 不用背字段名。

---

## 2. 更新从哪来，怎么进调度

常见入口：`setState`、`useState` 的 dispatch、`forceUpdate`、父组件传来的新 props、Context 变化。

它们都不会直接改 DOM，而是：

```text
创建 Update → 挂到对应 Fiber 上 → scheduleUpdateOnFiber → Scheduler 选时间跑
```

**18 的自动批处理**：同一个事件、同一个 `setTimeout` 里连写几次 `setState`，默认合成一次更新。不想合并用 `flushSync`。细节见 `setState.md`。

`createRoot` 才走 Concurrent；老的 `ReactDOM.render` 仍是偏同步的那条路。升级 18 但没换 `createRoot`，可中断那套不会真正开起来。

---

## 3. 调度：谁先跑、何时让路

Scheduler 干两件事：

- **时间片**：一段 JS 跑一小会儿（量级约 5ms）就问浏览器「有没有更急的事」，有就 `shouldYield`，下次再接着干
- **优先级（lane）**：更新带优先级，高优可以插队，低优必须让路

一面够用的档位（不必背 lane 位掩码）：

| 场景 | 优先级 | 典型 API |
|------|--------|----------|
| 点击、输入、`flushSync` | 最高 / 同步 | 事件里的 `setState` |
| 普通 `setState` | 默认 | 大多数业务更新 |
| 可延迟的 UI | 低 | `startTransition` / `useTransition` |
| 真不急 | 最低 | `useDeferredValue` 一类 |

**优先级是干什么的：** 保证用户能立刻看到「我点了 / 我输入了」，大列表、过滤结果可以晚一帧再齐。

---

## 4. Render 阶段：可中断，不上屏

从根（或找到的更新起点）沿着 Fiber 链表走：

- **beginWork**：算这个节点的子节点，走 Diff（同层比、靠 key 复用）
- **completeWork**：这个节点的子树在内存里收完，打上 Placement / Update / Deletion 等 effect

全程只改 `workInProgress` 这棵「草稿树」。`current` 还是屏幕上那棵，DOM 不动。

被打断时：

- 进度可以停在某个 Fiber 上，空闲再接着
- 若来了更高优更新，当前这次 render **可以丢弃**，草稿作废，从 `current` 再开一棵新的 `workInProgress`
- 因为没 commit，用户看不到半截新 UI

**追问必答对：** render 可中断 ≠ 页面上会出现半成品。中断的是内存里的协调，不是 DOM 的一半。

Diff 规则仍是同层、`type` + `key` 决定复用。key 为什么不能用 index，见 `react原理.md`。

---

## 5. Commit 阶段：必须一次做完

render 整棵草稿完成（root 完整），才进入 commit。这一段同步、不可中断，否则 DOM 会处于「改了一半」的不一致状态。

概念上三刀（名字可以模糊，顺序不能反）：

1. **before mutation**：读旧 DOM（如 `getSnapshotBeforeUpdate`）
2. **mutation**：按 effect 链表真正插、改、删 DOM
3. **layout**：DOM 已是新的，浏览器还没 paint。跑 `componentDidMount` / `DidUpdate`、**`useLayoutEffect`**

然后根指针切换：`root.current = 刚完成的那棵树`。下一帧用户才看到新画面。

**`useEffect` 不在这三刀里。** 它是 commit 之后、paint 之后的被动 effect，异步，不堵首次绘制。要在用户看见之前读布局、同步改 DOM，必须 `useLayoutEffect`。

---

## 6. 双缓冲：为什么半成品不会先画出来

两棵树，同一套 Fiber 节点上挂着「当前」和「正在做」的交替：

```text
current          ──  已经呈现在屏幕上
workInProgress   ──  这次更新的草稿，随时可扔

commit 成功  →  切换指针，草稿变成 current
高优打断     →  扔掉 WIP，current 不动，屏幕不动
```

这就是双缓冲。和 canvas 双缓冲一个意思：画完再切，避免撕裂。

---

## 7. 高优插队、低优让路（必举例子）

搜索框过滤大列表：

```jsx
function Search({ items }) {
  const [text, setText] = useState('')
  const [list, setList] = useState(items)

  const onChange = (e) => {
    const value = e.target.value
    setText(value) // 高优：输入框立刻跟上
    startTransition(() => {
      setList(items.filter((x) => x.includes(value))) // 低优：列表可被打断
    })
  }

  return (
    <>
      <input value={text} onChange={onChange} />
      {list.map((x) => <Row key={x} text={x} />)}
    </>
  )
}
```

用户连续打字：

1. 每次按键的 `setText` 是高优，必须尽快 commit，输入不卡
2. 列表那次 render 又重又低优，走到一半发现有新输入 → **让路**，未完成的列表草稿丢掉
3. 输入先上屏；列表等空闲再算最新关键字，避免「输入已经是 `ab`，列表还在渲染 `a` 的半截结果」

`useDeferredValue(text)` 是同一套思想：紧急值立刻更，派生的重渲染当低优。

---

## 8. 和 Vue 更新比（一面爱问）

| | React | Vue |
|--|--------|-----|
| 谁知道要更新 | 你调 `setState`，默认子树跟着 render | 依赖收集，谁用了谁更新 |
| 粒度 | 容易整棵子树都跑，靠 `memo` / `PureComponent` 截断 | 组件级更细 |
| 长任务 | Fiber 可中断 + 优先级 | 队列 watcher + `nextTick` 合并，**没有**这套 Concurrent 打断 |
| 上屏 | commit 才改 DOM | `patch` 才改 DOM |

Vue 连续改 10 次数据也不会 10 次 patch，靠的是队列去重，不是时间片。别把 `nextTick` 说成 Fiber。

---

## 追问速答（中位数一面就这些）

**一次更新拆成哪几步？哪段可中断？**  
调度 → render（可中断）→ commit（必须一次做完）。调度只是排队；真正费 CPU 的是 render。

**半成品会不会先画到页面上？**  
不会。render 只写 `workInProgress`。commit 才改 DOM、才切 `current`。打断 = 丢草稿，屏幕仍是旧树。

**优先级是干什么的？**  
让紧急更新先 commit。输入、点击走高优；过滤大列表用 `startTransition` 走低优，可被下一轮输入打断。

**高优插队、低优让路的例子？**  
搜索框：`setText` 高优保证输入跟手；`startTransition` 里过滤列表，打到一半被下一次按键丢掉重来。

**`useLayoutEffect` 和 `useEffect` 分别在哪？**  
layout：commit 改完 DOM、paint 前，同步。effect：paint 后，异步。要测 DOM 尺寸再决定样式，用 layout，否则会闪一帧。

**`setState` 是同步还是异步？**  
18 + `createRoot` 下几乎都异步批处理。立刻读 DOM 用 `flushSync`。这题别展开成整篇 `setState`，点到批处理即可。

**Diff 在哪一段？**  
render 的 beginWork。commit 只消费已经打好的 effect，不再重新比整棵树。

**React 15 为什么卡？Fiber 改了什么？**  
递归不能停。改成链表 + 时间片 + 双缓冲，协调可让路，提交仍同步。

**没 `createRoot` 有 Concurrent 吗？**  
没有。18 的可中断默认跟 `createRoot` 绑在一起。
