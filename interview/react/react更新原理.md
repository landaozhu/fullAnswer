# React 更新原理

25k 一面过关线：能 **顺着一条链路讲完**「`setState` → 调度 → 内存里 Diff → 一次性改 DOM」；中间能自己接上 **为什么可中断、为什么半成品不上屏、高优怎么插队**。只报「虚拟 DOM + Diff」或把 Fiber / 优先级 / 双缓冲拆开背，过不了。

配套：`setState.md`、`react原理.md`（key）、`react18更新了什么.md`。本题只讲 **一次更新怎么走完**。

---

## 面试怎么讲（先把这段说完）

React 15 更新是递归把整棵树走完，一开就不能停，列表一大就会卡住输入。后来改成 Fiber：每个节点是链表上的一个单元，主线程可以在单元之间把控制权交回去。

一次更新不是立刻改 DOM。你调 `setState` / `useState`，React 先把这次更新记在对应 Fiber 上，按优先级排进调度。同一轮事件里连写几次，18 会合成一次（自动批处理）。

轮到跑的时候，不碰屏幕上那棵树。另起一棵草稿（`workInProgress`），从根往下 Diff：能复用的复用，要改的打标记。这一段可以暂停，也可以整棵丢掉重来，因为 DOM 还没动。屏幕始终对应已经呈现的那棵 `current`。

草稿完整了，才进入 commit：按标记一次性插、改、删 DOM，然后把根指针切到这棵新树。这一段必须同步做完，否则页面会处于改了一半的状态。浏览器这才 paint。`useLayoutEffect` 在改完 DOM、paint 之前；`useEffect` 在 paint 之后。

所以：可中断的是内存里的协调，不是 DOM。半成品不会先画出来。紧急的输入走高优，先 commit；过滤大列表用 `startTransition` 标低优，打到一半可以被下一次按键丢掉。

前提是 `createRoot`。还在用 `ReactDOM.render`，这条 Concurrent 路没开。

---

## 把这段拆开：还是同一条链路

下面每一节都是上面那口话的下一句，不要当成新题目。

### 1. 为什么先有 Fiber（否则后面都没法中断）

浏览器一帧大约 16.6ms。JS 占着主线程，输入和动画都排不上。

React 15 靠调用栈递归 diff，等于一次超长同步函数，中途没法把控制权交回去。Fiber 把组件 / DOM 做成对象，用 `child` / `sibling` / `return` 串成链表。工作循环变成：做一个节点 → 看要不要让出主线程 → 继续、暂停、或丢掉重来。

**可中断的单位是 Fiber，不是整棵树。** 字段名不用背。

### 2. setState 之后：先记账，再调度

`setState`、`useState`、`forceUpdate`、父组件新 props、Context 变化，都不会直接改 DOM。先创建 Update 挂到 Fiber 上，再交给 Scheduler：什么时候跑、谁先跑。

同一事件、同一个 `setTimeout` 里连写几次，18 默认合成一次更新。立刻读 DOM 用 `flushSync`。细节见 `setState.md`。

Scheduler 两件事绑在一起：

- 跑一小会儿（量级约 5ms）就问有没有更急的事，有就让出主线程
- 更新带优先级。点击、输入、`flushSync` 最高；普通 `setState` 默认；`startTransition` / `useTransition` 低；`useDeferredValue` 更不急

优先级不是单独知识点，就是调度在决定 **谁先进入下面的 render**。

### 3. Render：在内存里 Diff，可停可扔

从更新起点沿着 Fiber 往下走：算出子节点、同层 Diff（`type` + `key` 决定复用，key 不能用 index 见 `react原理.md`），给要插、改、删的节点打标记。

全程只写草稿树 `workInProgress`。`current` 还是屏幕上那棵，DOM 不动。

被打断就停在某个节点，空闲再接着；来了更高优，这次草稿可以整棵作废，从 `current` 再开一棵新的。用户看不到半截新 UI，因为还没 commit。

**可中断 ≠ 页面上出现半成品。** 中断的是内存里的协调。

### 4. Commit：草稿齐了，一次性改 DOM

render 完整了才 commit。这一段同步、不可中断——DOM 改一半，UI 就不一致。

顺序不能反：先读旧 DOM（`getSnapshotBeforeUpdate`）→ 按标记真正改 DOM → 再跑 `componentDidMount` / `DidUpdate` 和 **`useLayoutEffect`**（DOM 已新，浏览器还没 paint）。然后根指针切换：`current` 变成刚完成的那棵树，下一帧用户才看到新画面。

`useEffect` 不在这段里。它是 paint 之后的被动 effect，不堵首次绘制。要在用户看见之前量尺寸、同步改样式，必须 `useLayoutEffect`，否则会闪一帧。

双缓冲就是 3 和 4 合在一起的原因：草稿随时可扔，切指针才上屏，避免撕裂。不必单独开一章。

### 5. 用一个场景把整条链路走完

搜索框过滤大列表：

```jsx
const onChange = (e) => {
  const value = e.target.value
  setText(value) // 高优：输入必须马上跟上
  startTransition(() => {
    setList(items.filter((x) => x.includes(value))) // 低优：列表可被打断
  })
}
```

连续打字时：`setText` 高优，尽快走完「调度 → render → commit」，输入不卡。列表那次 render 又重又低优，走到一半发现有新按键，草稿丢掉，屏幕上的列表仍是旧的（还没 commit）。输入先上屏；列表等空闲再按最新关键字算。避免「框里已经是 `ab`，列表还在渲染 `a`」。

这就是高优插队、低优让路。`useDeferredValue(text)` 同一套：紧急值先更，派生的重渲染当低优。

---

## 追问接到哪一句

面试官插话时，从上面那条链接着说，不要另起炉灶。

**一次更新哪段可中断？**  
Render 可中断。调度只是排队。Commit 必须一次做完。

**半成品会不会先画出来？**  
不会。Render 只写草稿；Commit 才改 DOM、才切 `current`。打断 = 丢草稿，屏幕仍是旧树。

**优先级干什么？举个例子？**  
让紧急更新先 commit。就是上面搜索框：`setText` 高优，`startTransition` 里过滤列表低优，可被下一轮输入打断。

**`useLayoutEffect` / `useEffect`？**  
都在 commit 之后；layout 在 paint 前，effect 在 paint 后。

**Diff 在哪一段？**  
Render 里。Commit 只消费已经打好的标记，不再重新比整棵树。

**和 Vue 比？**  
Vue 靠依赖收集，谁用了谁更新，队列去重后 `patch`；没有这套 Concurrent 打断。别把 `nextTick` 说成 Fiber。React 默认子树跟着 render，靠 `memo` 截断。

**没换 `createRoot` 呢？**  
Concurrent 没开，可中断那套走不起来。
