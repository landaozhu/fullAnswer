# Vue3 做了什么编译优化

25k 一面过关线：能说出 **四件事 + 各自省了哪一步**；静态提升要能补一句 **大块会预字符串化**；追问能讲清 **PatchFlag 必须配 Block**、**事件为什么进 `_cache` 而不是提到模块外**。只报 tree-shaking / Proxy 不够。

---

## 开口（40 秒，先结论）

Vue 2 模板编完就是一份 render：**每次数据变，整棵 vnode 重建，再整棵树 diff**。编译器没告诉运行时哪里会变。

Vue 3 模板结构编译期就能看清，所以把「谁静态、谁动态、动态的改哪」写进产物：

1. 静态的提到 render 外面，别反复 `createVNode`；连续静态够大再编成 HTML 字符串，挂载走 `innerHTML`
2. 动态的打 PatchFlag，patch 只比会变的字段
3. 用 Block 把动态节点收成扁平名单，别为了找它们去遍历静态子树
4. 内联事件缓存在实例上，函数引用别每次都新的，子组件才比较得过

不是 Vue 3 取消了 diff，是 **编译器把 diff 的搜索范围砍掉了**。Tree-shaking 只是包体积，不是这题主干。

---

## 1. 静态提升：少创建 vnode

```vue
<div>
  <p class="tip">永远不变</p>
  <p>{{ msg }}</p>
</div>
```

Vue 2：`msg` 变一次，上面那个静态 `p` 也再 `createElement` 一次，然后 diff 发现一模一样。

Vue 3：静态节点提到 render **外面**（模块作用域 `_hoisted_1`），flag 是 `-1`。render 里直接引用同一个对象。静态 props 对象 `{ class: "foo" }` 也会被提出去，避免每次新建字面量。

**追问必答对：** 提升的是 **JS 里的 vnode / props 对象**，不是 DOM。DOM 还是第一次 patch 才有。省的是分配和 GC，以及后续 patch 可以直接跳过这份 vnode。

组件 vnode 一般不这么提：组件有实例、有副作用，不能当纯静态节点复用。

`v-once` 是你手动冻一块（里面可以有动态数据，算一次就停）。静态提升是编译器发现「这里完全没动态绑定」自动做。能提升的不用写 `v-once`。

### 静态提升之后：预字符串化（stringifyStatic）

提升只是少反复建 vnode。挂载时 20 个静态 vnode 仍是 20 次 `createElement`。

连续静态节点够大（源码阈值：**20 个节点**，或 **5 个带静态绑定的元素**），`@vue/compiler-dom` 再砍一刀：整段编成 HTML，一个 `createStaticVNode`：

```js
const _hoisted_1 = createStaticVNode(
  `<div class="foo"><p>a</p><p>b</p>…</div>`,
  20
)
```

运行时丢进临时容器的 `innerHTML`，再把节点搬到真正位置。更新直接跳过。N 个静态 vnode → **1 个静态 vnode + 1 次插入**。

**这是静态提升的下一刀，不是第五件独立的事。** 笔记上面那个单独的 tip `p` 只 hoist，达不到阈值不 stringify。

不能 stringify：slot、组件、`v-once`、`tr`/`td` 这类 table 内部标签（`innerHTML` 插进去和手插 DOM 结构会不一致）。只在 **构建时的 compiler-dom** 做，浏览器只消费产物。

和 SSR 不是一回事：SSR 是整页输出 HTML 字符串；这是客户端大块静态用 `createStaticVNode`。

---

## 2. PatchFlag：知道改哪，就只改哪

动态节点 `createVNode` 第四个参数是个位标记：

| 你写的 | flag | patch 只干啥 |
|--------|------|----------------|
| `{{ msg }}` | TEXT (1) | 改文本 |
| `:class` | CLASS (2) | 改 class |
| `:style` | STYLE (4) | 改 style |
| `:id="id"` | PROPS (8) + `['id']` | 只比这几个 prop |
| `v-bind="obj"` | FULL_PROPS (16) | 编译期不知道有哪些 key，退回全量比 |

```vue
<div class="foo" :id="id">{{ text }}</div>
```

编出来大约是 flag `9`（`1 | 8` = TEXT + PROPS）。`class="foo"` 看都不看。

Vue 2 没有这信息，新旧 vnode 的 class / style / props / children 都走一遍。

**反例要能举：** `v-bind="obj"` 优化不了靶向更新。手写 `h()` / 纯 render 函数同样没有这些 flag，优化退回 Vue 2 那套。所以这是 **模板编译器** 的能力，不是运行时自己分析出来的。

---

## 3. Block Tree：先找到那些动态节点（和 PatchFlag 必须一起讲）

只打 PatchFlag 没用：还得知道树上哪些节点带了 flag。若还是递归整棵树，静态的 `section`、`article` 白走一层。

Vue 3 在创建时用 `openBlock`：碰到带正数 PatchFlag 的节点，推进当前 Block 的 **`dynamicChildren` 扁平数组**。更新时只遍历这份名单，中间静态层级直接跳过。

```vue
<div>                 <!-- Block 根 -->
  <section>
    <article>
      <p>{{ msg }}</p>  <!-- 唯一进 dynamicChildren -->
    </article>
  </section>
</div>
```

`msg` 变了：不走进 `section`/`article`，名单里就那一个 `p`，再按 TEXT flag 改文本。

**复杂度约等于动态节点数，不是 DOM 树深度。** 这是 25k 要听到的那句。

### 为什么 v-if / v-for 要新开 Block

`dynamicChildren` 新旧两次数组是 **按下标对齐** 的。结构一变，下标全错：

- `v-if`：这次渲染 A 分支、下次渲染 B 分支，名单内容都换了
- `v-for`：长度、顺序会变
- 子组件：内部树编译器看不见

所以这些地方自己成为一个 Block（Fragment）。父 Block 只收录这个 **Block 根**，里面那一截自己管。这叫 Block **树**，不是全组件一个大数组。

`v-for` 有 `:key` → keyed fragment，按 key 复用；没 key → 只能按下标对齐。结论和 Vue 2 列表 diff 一样，只是标记写在编译产物上。

---

## 4. 事件缓存：函数引用稳住，子组件才跳得过

这是面经里最容易挂的点（只知道 tree-shaking、说不出 cacheHandlers）。

### `<div @click="count++">` 编译差在哪

Vue 2 每次 render **new 一个函数**：

```js
with (this) {
  return _c("div", {
    on: { click: function ($event) { count++ } }
  })
}
```

Vue 3 放进实例的 `_cache`，引用永远同一个：

```js
function render(_ctx, _cache) {
  return (openBlock(), createElementBlock("div", {
    onClick: _cache[0] || (_cache[0] = ($event) => (_ctx.count++))
  }))
}
```

写在原生 `div` 上：少分配一个函数。真正减 **子组件更新** 是这种：

```vue
<Child @change="count++" />
```

Vue 3 里组件监听器是 `onXxx` **props**。父组件更新时会浅比较子组件 props：函数是新的 → 认为 props 变了 → 子组件 render 白跑一遍。缓存后 `onChange` 引用不变，其它 props 也不变，就可以跳过子组件。

`@click="handleClick"` 绑的是 methods / setup 里那个函数，引用本来就稳，缓存主要救 **内联表达式**（`count++`、`() => xxx`）。

动态插槽会打 `DYNAMIC_SLOTS`：槽内容随父组件变，子组件照样更新。别说「事件一缓存，子组件永远不更新」。

### 为什么事件不能像静态节点那样 hoist 到模块外

静态 `<p>hi</p>` 跟组件实例无关，提到模块作用域一份就行。

`($event) => _ctx.count++` **闭包的是当前实例的 count**，提到模块外会串实例、或根本拿不到 `_ctx`。所以只能缓存在 **这个实例的 `_cache` 数组** 里。

面试听到「静态提升和事件缓存不都是缓存吗」就答这一句。

---

## 更新链（用来收口）

```
Vue 2：data 变 → 整份 render → 整棵 vnode 新建 → 全量递归 diff → 改 DOM

Vue 3：data 变 → 静态 vnode 直接复用（大块可能是一段 innerHTML）
      → 只创建动态 vnode
      → Block 按 dynamicChildren 找人
      → 按 PatchFlag 只改该改的 DOM
```

---

## 追问速答（中位数一面就这些）

**只知道 tree-shaking 算过关吗？**  
不算。那是体积。这题问的是 **更新时少 diff、少建 vnode**。

**Vue 3 还有没有 diff？**  
有。列表还是 keyed / 最长递增子序列那套。编译优化是少进入 diff、进去了也少比字段。

**静态提升提升的是 DOM 吗？**  
不是。是 vnode / 静态 props 对象。预字符串化才在**首次挂载**用 `innerHTML` 一次插 DOM。

**静态提升和预字符串化什么区别？**  
提升：vnode 提到 render 外，挂载仍一个个 `createElement`。字符串化：连续静态够大，编成一段 HTML，一次插入，更新跳过。小块只 hoist。

**为什么有 20 / 5 的阈值？**  
`innerHTML` 解析也有成本，小块不如直接建 DOM。编译还要再走一遍树。

**PatchFlag 运行时自己分析行不行？**  
不行。模板编译期才知道「这个节点永远只改 text」。手写 `h()` 没有 flag。

**为什么 v-if 要单独 Block？**  
扁平名单按下标对齐；分支一切，下标错位，会把别的动态节点 patch 到错误的 DOM 上。

**事件缓存在原生元素上有什么用？**  
少 new 函数。减子组件更新要看事件是不是作为 props 传给了子组件。

**和 React memo 比？**  
React 内联函数 / 内联对象每次都是新引用，要自己 `useCallback` / `memo`。Vue 模板这条编译器代劳了。JSX 写 Vue 则帮得少。
)
