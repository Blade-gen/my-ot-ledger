# AGENTS.md

给 AI 编码代理的约定与踩坑记录。**动手改代码前先读完本文**，
尤其是「不可回退的坑」一节 —— 那些都是「不报错但肉眼可见」的问题，
很容易在后续改动中悄悄回来。

> 文件名说明：本项目用 `AGENTS.md`（复数）。
> DSH 的 `dsh-agent-instructions` 只自动加载 `AGENTS.md` / `CLAUDE.md`，
> 写成 `AGENT.md` **不会**被加载。改名前请先确认工具链的约定。

## 项目速览

个人加班时长看板。**纯静态站点**，无后端。Vue 3.6 **Vapor Mode** + Vite。
打卡数据由外部私有仓库定时推送到 `otData/`，本站只负责读和算。

```
数据流：punch-tracker（私有）→ push otData/ → CI 构建 dist/ → GitHub Pages
```

## 命令

```bash
pnpm install          # 必须用 pnpm，npm 会 ERESOLVE 失败（见下）
pnpm dev              # 开发服务器 :5173（内置 /otData 中间件）
pnpm build            # 构建到 dist/（自动拷 otData/）
pnpm test             # 纯逻辑自检，不依赖浏览器 —— 改统计逻辑后必跑

# 端到端测试（需先 build，再起静态服务器）
npx serve -l 4190 dist && node scripts/e2e.mjs                 # 64 项（含选择器居中/图标/hover/点按高亮/弹层）
node scripts/make-fixtures.mjs                                  # 生成 .tmp-* 站点
npx serve -l 4191 . && node scripts/e2e-fixtures.mjs           # 28 项（懒加载/兜底/失败/开关）

# 加载态（13 项）：**必须跑 dev 模式**，见下方说明
pnpm dev
BASE_URL=http://localhost:5173/ node scripts/e2e-loading.mjs
```

**改动后至少要跑**：`pnpm test` + `pnpm build` + `node scripts/e2e.mjs`。
改了加载/数据路径再加跑 `e2e-fixtures`；改了 loading 或状态提交时序再加跑 `e2e-loading`。

> ⚠️ `e2e-loading.mjs` 的 box-sizing / 两个 loading 一致性断言**只在 dev 模式有效**。
> dev 下 CSS 由 JS 注入，存在「HTML 已到、`app.css` 未到」的窗口；
> 生产构建的 CSS 是渲染阻塞的 `<link>`，那个窗口不存在，测了也永远是绿的。
> 脚本在非 dev 模式下会打印这个警告。

## 必须遵守的硬约束

1. **依赖只能用 pnpm。**
   `vue@3.6.0-rc.9` 是预发布版，plugin-vue 的 peer 是 `^3.2.25`，
   npm 会 `ERESOLVE` 失败。版本由 `package.json` 的 `packageManager` 决定，
   workflow 里**不要**再写 pnpm `version`（会造成版本漂移）。

2. **不要往 `package.json` 塞 `pnpm` 字段。**
   pnpm 11 已不读它（会警告并忽略）。配置写在 `pnpm-workspace.yaml`。
   当前必须保留 `allowBuilds.esbuild: true`：esbuild 需要执行安装脚本放置
   平台二进制，被拦截时 pnpm 以 `ERR_PNPM_IGNORED_BUILDS` 退出（exit 1）会让 CI 失败。

3. **所有 `.vue` 必须是 `<script setup>`。**
   plugin-vue 的 `canForceVaporMode`：只有普通 `<script>` 的 SFC 无法被强制成 Vapor。
   不要写 Options API 风格的 SFC。

4. **产物必须真的不含 `createVNode`。**
   `features.vapor` 配错时**不报错，只会静默退回 vdom**。
   CI 里有断言守着；本地可用 `grep -c createVNode dist/assets/*.js` 自查（应为 0）。

5. **`vite.config.mjs` 的 `base: './'` 不能改。**
   Pages 项目站点在 `/my-ot-ledger/` 子路径下，绝对路径 `/assets/...` 会 404。

6. **统计口径改动必须同步四处**：`src/lib/model.js` 的 `computeDays`/`summarize`、
   `scripts/selftest.mjs` 的断言、`src/components/RulesSheet.vue` 里给用户看的规则说明、
   以及涉及该口径的提示文案（如 `ChartBlock.vue` 的 `tipFor`）。四者不一致就是 bug。

## 设置项的统一模式

新增一个设置项时，**这条链路一处都不能漏**（漏了不会报错，只会静默失效）：

| 位置 | 要做什么 |
|---|---|
| `src/lib/store.js` | `DEFAULT_CONFIG` 加默认值；`sanitize()` 加**显式归一化**（默认开的布尔用 `x !== false`，默认关的用 `x === true`）；`get()` 合并 local 时带上；`exportConfig()` 导出带上 |
| `src/lib/model.js` | 在 `computeDays` 里读 `settings.xxx` 参与判定 |
| `src/components/SettingsSheet.vue` | 加一行 `.setting-row` + `.switch`（或输入框），`emit('save-xxx')` |
| `src/App.vue` | `@save-xxx="settings.save({ xxx: $event })"` |
| `src/components/RulesSheet.vue` | 文案随开关变化（用 `v-if` 写两种说法） |
| `scripts/selftest.mjs` | 断言开/关**两种**行为 |
| `scripts/e2e-fixtures.mjs` | 端到端切换开关，断言统计数字真的变了 |

⚠️ 三个容易漏的点：

1. **`sanitize()` 里的归一化别用真值判断**。布尔默认值要用
   `forgotCounts: cfg.forgotCounts !== false` 这种「只认显式 false」的写法，
   这样「缺省」和「显式 true」都算开。写成 `Boolean(cfg.x)` 会让缺省值变成 `false`，
   默认开启就失效了。
   ⚠️ 反过来，**默认关**的布尔要用 `=== true` 只认显式 true ——
   `pendingCounts` 就是默认关（`cfg.pendingCounts === true`），
   照抄默认开那套 `!== false` 会让它静默变成默认开。
2. **`store.get()` 合并 local 时必须逐项列出**，它不是展开合并。
   新字段忘了加，本机保存后就丢掉该设置。
3. **`useSettings` 暴露的是 `cfg` 这个 ref**，组件里读 `settings.cfg.value.xxx`。

端到端测「开关真的生效」需要**数据里存在该状态的日子**。
`pendingCounts` 就是例子：「今日待更新」有两种形态 ——
「今天打了上班卡、还没打下班卡」和「今天一条卡都没有」。
后者是 `groupByDate` 产不出来的（它只产出数据里出现过的日期），
必须由 `computeDays` 在 `pendingCounts === true` 时**补一天**，
否则开关对它完全失效：实测 9/18 无记录时，开关怎么切日均都是 1.79（打开应为 968/10 = 1.61）。
补出来的那天 `punches` 为空、`first`/`last` 是 `undefined`，
所以 `inTime`/`outTime` 要兜空串、`summarize` 的 `latest` 要跳过没有 `last` 的日子
（否则整站直接崩）—— 这两处都有 selftest 守着。

一个站点只能有一个「今天」，所以 `scripts/make-fixtures.mjs` 往 `.tmp-multi` 里塞的是
「今天只有上班卡」那种形态；「今天一条卡都没有」由 `selftest.mjs` 的合成数据覆盖。

### 仓库默认配置（`ot-ledger.config.json`）必须随产物发布

`store.loadRemote()` 是按**相对路径** `fetch('ot-ledger.config.json')` 读它的。
文件不在产物里 → 404 → `store.js` 的 `catch` **静默忽略**，页面不报错，
只在设置面板显示「未提供（可选）」，仓库默认值全部不生效。

所以 `vite.config.mjs` 的 `copyRootData()` 要把它和 `otData/` 一起拷进 `dist/`。
⚠️ v1 的 workflow 里有 `cp ot-ledger.config.json _site/`，重写成 Vite 时**漏过一次**
（就是这个坑）。`scripts/e2e.mjs` 有断言守着：设置弹层里
「仓库默认配置」的值必须是 `ot-ledger.config.json` 而不是「未提供（可选）」。

`ot-ledger.config.json` 在仓库里是**可选**的：不存在时不报错，
`store.js` 用 `DEFAULT_CONFIG` 兜底。

## Vapor Mode 的四个静默失败陷阱

这些是实测（装真包、编真码、在真 Chrome 里跑）得出的，全部**不报错**：

| 陷阱 | 现象 | 正确做法 |
|---|---|---|
| 用 `createApp` 而非 `createVaporApp` | **页面完全空白，无任何报错** | 入口必须 `createVaporApp` |
| `vue` 未别名到 vapor 入口 | 同上（默认导出的是 vdom 运行时，没有 `createVaporApp`） | 别名到 `vue/dist/vue.runtime-with-vapor.esm-browser{,.prod}.js` |
| 别名的 `find` 写成字符串 `'vue'` | 构建报 ENOENT，路径变成 `vue/dist/.../dist/...` | 必须用 `/^vue$/` 精确匹配 |
| SFC 缺少 `<script setup>` | 静默退回 vdom 编译 | 见硬约束 3 |

补充：vapor 运行时**只以 esm-browser 预构建形式**提供，
`vue` 的 `exports` 里**没有** `./vapor` 子路径，只能走 dist 全路径。

## 不可回退的坑

每一条都对应一个已修的 bug，且有测试守着。**改之前先想清楚**。

### 1. `computed(() => store.hasLocal())` 是错的

`store`（`src/lib/store.js`）是普通对象，不是响应式的。
computed 没有任何响应式依赖 → 只求值一次后**永久缓存**，
于是保存配置后页脚永远不显示「含本机未提交的标记」。

✅ 正确做法见 `useSettings.js`：用真正的 `ref`，每次改动 store 后调 `sync()`。

### 2. 可选月份只能来自 `index.json`

**不要**用「已加载的记录」反推有哪些月份。月视图下只加载了当月，
用记录反推会让月份选择器**只剩一项**。

```js
// ✅ 唯一来源
const months = computed(() => index.value?.months || []);
```

### 3. `month` 与 `records` 必须在同一个同步块里改

`activeDays` 是「按 `month` 过滤 `records`」算出来的。
若先 `month.value = target` 再 `await` 取数据，中间会渲染出
「新月份 + 旧数据」→ 过滤结果为空 → 闪一下全 0 概览与「该月暂无打卡记录」。

✅ 用 `commitMonth(target, list)`：先 await 拿到数据，再和 `month` 一起提交。
Vue 会合并成一次渲染，不留中间帧。

### 4. 首屏 loading 必须写在 `index.html` 里，且样式**唯一定义在那里**

- 脚本是 module（延迟执行），只靠 Vue 渲染遮罩的话，
  HTML/JS 到达之前页面是空白的（高度坍缩）。
- 遮罩样式（`.loading` / `.loading-box` / `.loading-text` / `.spinner` /
  `.loading-bar` / `@keyframes spin`）**只在 `index.html` 的内联 `<style>` 里定义一份**，
  **不要抄回 `app.css`**。原因有两层：
  1. 开发模式下 `app.css` 由 JS 注入，等它到达时遮罩已按浏览器默认样式画过一帧
     ——「左上角一行无样式文字 → 突然跳变成居中白卡片」。
  2. 更隐蔽的是 **`box-sizing`**：`app.css` 有全局 `* { box-sizing: border-box }`，
     在它生效之前内联样式按默认 `content-box` 计算，
     卡片被撑成 **216px**、spinner 变成 **30px**；CSS 到达后才缩回 **168px / 26px**。
     这正是「两个 loading 看起来不一样」的根因。
     → 所以 `.loading` 必须**显式声明 `box-sizing: border-box`**（含 `.loading *`）。
- HTML 兜底遮罩与 `LoadingOverlay.vue` 用**完全相同的 class**，共用这一份样式，
  因此从第一帧到 Vue 接管逐像素一致。改 class 名要**同时改两处**。

⚠️ 颜色写字面量而非 `var(--bg)`：那些 CSS 变量定义在 `app.css` 的 `:root` 里，
   在本样式块生效的时点还不存在。改色时同步 `app.css` 的变量取值。

### 5. `.loading` 不能加淡入动画

遮罩需要**第一帧就完全不透明**。若从 `opacity:0` 淡入，
移除 HTML 兜底遮罩后会有约 160ms 页面透出来。

### 6. 兜底遮罩的移除放在 `LoadingOverlay` 的 `onMounted`

**不要**放在 `main.js` 里 mount 之后同步删除。
Vapor 下首次渲染可能晚于 `mount()` 返回一帧，
同步删除会产生「兜底已删、Vue 还没画」的**空档帧**。

### 7. 改了源码要重新 build 再跑 fixture 测试

`scripts/make-fixtures.mjs` 是把当前 `dist/` 拷进 `.tmp-*` 站点的。
忘了 build 就会测到旧 bundle —— 表现为「故意把修复回退掉，测试居然还是绿的」这种
**假绿**。脚本现在会打印所用产物文件名，便于核对。

> 这条是真实踩到的：曾因此误判「回归测试没用」，实际是测了旧产物。

## 验证方法论（重要）

本项目的问题大多是**时序/视觉**问题，静态看代码看不出来。
所以验证一律走真实浏览器（CDP 直连 Chrome，无第三方依赖）：

- `scripts/e2e.mjs` —— 功能面：渲染、视图切换、排除/恢复、设置、窄屏
- `scripts/e2e-fixtures.mjs` —— 数据面：懒加载请求数、兜底、失败路径
- `scripts/e2e-loading.mjs` —— **时序面**：用 `requestAnimationFrame` 连续采样 DOM，
  找出「异常帧」（无样式帧、空数据帧、尺寸跳变帧）。这是唯一能证明「无突变」的手段。
  **要跑 dev 模式**：样式相关的断言依赖「CSS 由 JS 注入」这个 dev 特性，
  生产构建下测不出来（详见「命令」一节的警告）。

**写完测试要反向验证**：故意把修复回退掉，确认测试**变红**。
否则你无法区分「测试有效」和「测试根本没跑到那段代码」。
（这条不是理论 —— 上面 §7 那个假绿就是这么发现的；
本次查「两个 loading 不一致」时也再次踩到：在生产构建上反证一直全绿，
换成 dev 模式才复现出 `216x105/sp30`。）

## 只做被要求的事：不要自作主张跑测试/构建

上一节的「改动后至少要跑 …」约束的是**改了代码的人**，触发条件是
**工作区里有你改动的源码**，不是「准备提交」。

⚠️ **「生成 commit message」「提交仓库」这类任务不触发上面任何验证。**
拿 message 就是把已暂存的 diff 读一遍、写成人话，
不需要 `pnpm test`、不需要 `pnpm build`、不需要起静态服务器跑 e2e。
没人改代码时跑一遍测试，得到的结论是「上一版是好的」，
跟本次提交无关 —— 白白拖几分钟，还会顺手起服务、污染 `dist/`。

规则：

- **你没有改代码 → 不跑测试。** 哪怕 AGENTS.md 里某条写着「必跑」。
- **想跑就先问。** 觉得有必要（比如怀疑暂存区里的东西是坏的），
  先说明理由并让用户决定，不要先跑了再说。
- **别为了「顺手验证」起后台服务**（`npx serve` 之类）。
  起来容易忘，留下孤儿进程和端口占用。
- **任务边界就是任务边界。** 「生成 message」= 给 message，
  「提交」= 提交；用户没说的步骤（跑测试、拆提交、改文件）都不要加。

> 这条是真实踩到的：用户让「生成 message 并提交仓库」，
> 代理却按上一节跑了 `pnpm test` + `pnpm build`，
> 还起了 `npx serve -l 4190` 准备跑 e2e，被用户叫停。

## 代码约定

- **`src/lib/` 是纯逻辑，不依赖 Vue**，可被 Node 直接 import。
  改统计逻辑时保持这一点，`scripts/selftest.mjs` 才能跑。
- **注释写「为什么」而非「是什么」**。本项目大量注释在解释踩坑原因，
  删除它们等于把坑重新埋回去。
- **组件全部 `<script setup>`**，用 `defineProps` / `defineEmits` / `defineModel`。
- **金额/时长格式化统一走 `model.js`**（`formatDuration`、`formatHours`），
  不要在组件里手写。
- 提交信息用中文，遵循现有风格（`fix:` / `feat:` / `docs:` / `chore:`）。

## 排除某天的唯一入口是明细表

**不要**再加「手动选日期排除」这类入口（曾经有过，已移除）。
同一天在「每日明细」表里点一下就能排除/恢复，两个入口语义重复，
而且日期控件与「排除」这件事在交互上不直观。

- 排除/恢复：`DetailTable.vue` 最后一列的按钮 → `toggleDate(date)`
- 改备注：`ExcludedChips.vue` → `setNote(date, note)`
- 相关断言：`scripts/e2e.mjs` 的「已移除「手动排除某天」」一条

`useLedger.js` 里**没有** `addExclusion` 了；`store.js` 的 `exclusions`
数据结构不变，旧配置里手动加的日期仍然生效。

## 弹层（sheet）的滚动结构

`.sheet` 是 **flex 纵向容器且 `overflow: hidden`**，
标题栏 `.sheet-head` 固定（`flex: 0 0 auto`），
只有 `.sheet-body` 滚动（`flex: 1 1 auto; min-height: 0; overflow-y: auto`）。

为什么要这样——两个坑：

1. **滚动条会压在圆角上**。早期是 `.sheet` 自己 `overflow-y: auto` +
   `padding: 0 18px`，滚动条贴着圆角边缘，Windows 默认样式又粗又带上下箭头，
   非常突兀。
2. **`min-height: 0` 不能省**。flex 子项默认 `min-height: auto`，
   会按内容撑开而不产生滚动，`.sheet-body` 就永远滚不动。

滚动条样式（`scrollbar-width: thin` + `::-webkit-scrollbar` 系列）写在
`app.css` 的 `.sheet-body` 下：8px 槽 + `border: 2px solid transparent` +
`background-clip: content-box`，视觉上是 4px 的浅灰细条。

> 写测试扫描样式表时**必须排除 `:hover` 变体**：它在表里排在后面，
> 不排除会把基础规则覆盖掉（`background-clip` 读成空）。见 `scripts/e2e.mjs`。

全屏宽/桌面断点下 `.sheet` 会改成垂直居中（`top: 50%` + `translate(-50%, -50%)`），
与上面的 flex 结构兼容，不要恢复成给 `.sheet` 加 `overflow-y: auto`。

## 图标：Remix Icon

**所有图标统一用 Remix Icon**，路径集中放在 `src/lib/icons.js`，
由 `src/components/AppIcon.vue` 渲染。不要在组件里写内联 `<svg><path>`。

```vue
<AppIcon name="chart" :size="16" />
```

约定与注意点：

- **viewBox 统一 `0 0 24 24`**（Remix 原生坐标系）。旧的内联图标是 20×20，
  已经全部替换；新增图标不要再引入别的坐标系。
- **Remix 图标全是填充路径**（连 `-line` 变体也是填充轮廓），
  所以一律 `fill="currentColor"`，**不需要 stroke**。
  颜色用外层 CSS 的 `color` 控制。
- **只内联 path，不引字体/CSS**。`remixicon` 是 **devDependency**，
  只作为取路径的来源（`node_modules/remixicon/icons/<分类>/<名>.svg`），
  不参与打包 —— 产物里不应出现 `.woff/.ttf` 或 `ri-*` 类名。
- 换/加图标：从 `node_modules/remixicon/icons/` 里取该文件 `path` 的 `d` 值，
  **原样**贴进 `ICON_PATHS`，不要手改 `d`。
- 图表（`BarChart.vue`）的 `<svg>` 是**数据可视化不是图标**，viewBox 由容器宽度算出，
  不要把它改成 AppIcon。

## 顶部月份选择器的居中约定

`.month-picker` 是 `[spacer][文字][箭头]` 三段结构，**左侧占位与右侧箭头等宽**
（都用 `--picker-caret`）。这样居中的是**文字**，而不是「文字+箭头」这个整体。

⚠️ 不要删掉 `spacer`：少了它，flex 会把整体居中，文字被箭头挤得偏左
（实测偏 **7.5px** ≈ (箭头 12 + gap 3) / 2）。`scripts/e2e.mjs` 里有断言守着
（文字中心偏移 < 1px、占位与箭头等宽、箭头与文字垂直对齐）。

同理，`.topbar-main` 的 `.title-row::before` 也是为「标题文字居中」做的等宽占位。

> 取元素时注意：`.month-picker span` 现在会命中 **spacer** 而不是文字，
> 要取文字请用 `.month-picker .picker-label`。测试脚本里已统一改过，
> 新写选择器时别再踩。

### hover 背景不能画在 `.month-picker` 盒子上

`spacer`（为文字居中而留的 16px 隐形占位）**在按钮盒子内部**，
所以给按钮本身加 hover 背景会把不可见的 spacer 一起染色：
文字左侧空 `8 + 16 + 3 = 27px`，而箭头右侧只有 8px —— 肉眼就是「左侧空一大块」。

✅ 背景画在 `.month-picker::before` 上，只覆盖可见内容、左右各留 8px：
`inset: 0 0 0 calc(var(--picker-caret) + var(--picker-gap))`（= 19px）。
这样「文字居中」仍由 spacer 负责，「背景贴合内容」由 `::before` 负责，两者解耦。

⚠️ 伪元素要 `z-index: -1`（配 `isolation: isolate`），否则 4% 的黑会盖在文字/图标上。
⚠️ 写断言时**必须同时检查按钮自身背景是透明的**（`rgba(0, 0, 0, 0)`）：
只量 `::before` 的几何位置的话，把背景改回按钮上**测不出来**（假绿，实测过）。

## 移动端点按的「蓝色方块」：`-webkit-tap-highlight-color`

移动端点按控件时，浏览器会额外叠一块**半透明系统色**高亮。
Chrome for Android 的默认值是 `rgba(51, 181, 229, 0.4)` 的蓝色，
画在元素**整个 border-box** 上、由合成器直接叠在所有内容之上
（**弹层遮罩也压不住**）——表现就是「点一下闪出一个蓝色方块」。

✅ 在 `html` 上全局关掉：`-webkit-tap-highlight-color: transparent;`
该属性**可继承**，写一次即覆盖全站（`.chart` 早期单独关过它，是同一个坑的局部版本）。
键盘聚焦提示由 `:focus-visible` 负责，不受影响（`e2e.mjs` 里两条断言分别守着）。

## 数据与安全

- 仓库是**公开**的：`otData/` 里的打卡时间、打卡地点（`ATTADDRESS`、`LOCATIONTYPE`）
  全世界可见。**不要把凭据写进本仓库**（密钥留在 `punch-tracker` 的 Secrets 里）。
- `otData/` 是**数据不是源码**，由外部推送，不要手改（会被覆盖）。
  `otData/README.md` 也会被外部版本覆盖，需要改说明请放在本文件或根 `README.md`。
- `PRIVATE-SETUP.md` 已被 `.gitignore` 忽略（仅本地存在）。
  **根 `README.md` 不要引用它** —— 公开仓库里的链接会失效。
- `otData/index.json` 是生成物但**要提交**，以便本地直接预览；
  内容变化请用 `node scripts/build-index.mjs` 生成，不要手写。

## 常见任务入口

| 想做什么 | 改哪里 |
|---|---|
| 改加班计算规则 | `src/lib/model.js`（`computeDays`）+ `selftest.mjs` + `RulesSheet.vue` + `ChartBlock.vue` 提示 |
| 加/改设置项 | 见上面「设置项的统一模式」—— 7 处链路，一处都不能漏 |
| 改图表外观 | `src/components/BarChart.vue` + `src/styles/app.css` |
| 换/加图标 | `src/lib/icons.js`（从 remixicon 取 path）—— 别在组件里写内联 svg |
| 调顶部标题/月份选择器 | `TopBar.vue` + `app.css` —— 注意等宽占位的居中约定 |
| 改弹层样式/滚动条 | `app.css` 的 `.sheet` / `.sheet-head` / `.sheet-body` —— 先读「弹层滚动结构」 |
| 改数据加载策略 | `src/lib/data.js` + `src/composables/useLedger.js` |
| 改月度清单生成 | `scripts/build-index.mjs` |
| 改部署流程 | `.github/workflows/deploy-pages.yml` |
| 调加载态/遮罩 | `index.html`（内联样式）+ `LoadingOverlay.vue` —— 先读「不可回退的坑」4~6 |
