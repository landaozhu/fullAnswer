## 为什么引入key
React Diff 默认采用同层级比较策略，复杂度为 O(n)。

但在列表场景下，例如头部插入元素时，会导致后续节点产生额外的更新甚至重建，带来不必要的渲染开销。

因此 React 引入了 key，通过 key 可以找到原来的节点进行复用，减少不必要的更新和重建，从而提升渲染性能。
## 为什么不能用index来用key
React Diff 时会优先根据 key 判断是否复用已有节点。

如果使用 index 作为 key，当列表发生头部插入、删除、排序等操作时，
节点对应的 index 会发生变化。

React 会错误地认为它们还是同一个组件，
从而复用错误的 Fiber 节点。

这样组件内部的 state 会跟着位置走，
而不是跟着数据走，
最终导致状态错乱，例如输入框内容错位、checkbox 选中状态错位等问题。

因此通常建议使用业务唯一 id 作为 key。
## react源码初始化
你真正要拿到的是这个结论：

<MyApp />
  ↓
React.createElement(MyApp, null)
  ↓
ReactElement.createElement(MyApp, null)
  ↓
返回一个 ReactElement 普通对象

等你看完 ReactElement.js，再切到：

ReactDOM.render(element, container)

因为 ReactDOM 接收的就是这个 element。

## 追问

更新链路（调度 / 可中断 render / 不可中断 commit、双缓冲、优先级）见 [react更新原理](./react更新原理.md)。

- Fiber 之后一次更新拆成哪几步？哪一段可以中断、哪一段必须一次做完？半成品会不会先画到页面上？
- 优先级是干什么的？举一个高优插队、低优让路的例子。
