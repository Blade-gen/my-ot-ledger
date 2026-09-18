# 加班时长看板

按「标准下班时间」统计每月平均加班时长的个人看板。纯静态站点，
打卡数据由定时任务从私有仓库推送过来。

**线上地址**：<https://blade-gen.github.io/my-ot-ledger/>

## 功能

- **月 / 全部** 两种范围：按月看每日加班时长，或看每月汇总
- **加班时长 = 末次打卡 − 标准下班时间**；忘打卡、打卡次数不足、
  当天数据未出全都会单独标注且不计入平均，避免拉低均值
- 任意日期可在**明细表最后一列勾选排除**（请假、调休），被排除的日期不参与任何汇总，可加备注；
  再次点击即恢复。已排除的日期会汇总到表格下方的「已排除的日期」区，可在那里补备注
- 图表：整月铺满的柱状图 + 平均值参考线，点柱子看当天明细
- 设置项（标准下班时间、最少打卡次数、忘打卡是否计入、今日未下班是否计入）即时生效，
  可只存本机，也可导出提交到仓库作为默认值；仓库默认值放在根目录可选的
  `ot-ledger.config.json`（构建时随产物发布，不存在则用内置默认值）
- **今日未下班**：默认**不**把「今天」计入平均（含今天还没打卡的情况），避免数据没出全就拉低均值；
  可在设置里打开，打开后今天按 0 加班计入，避免月初只统计已完整的日子、让日均看起来偏高

## 技术栈

| 项 | 版本 | 说明 |
|---|---|---|
| Vue | 3.6.0-rc.9 | **Vapor Mode**（无虚拟 DOM） |
| Vite | 7.3.6 | 构建 |
| @vitejs/plugin-vue | 6.0.9 | 通过 `features.vapor` 强制 Vapor 编译 |
| Remix Icon | 4.9.1 | 图标（仅取路径内联，不打包字体） |
| Node | ≥ 20.19 | |
| pnpm | 11.11.0 | 见下方说明 |

> **为什么用 pnpm**：`vue@3.6.0-rc.9` 是预发布版，而 `@vitejs/plugin-vue`
> 的 peer 范围是 `^3.2.25`，npm 会判定冲突并以 `ERESOLVE` 失败；
> pnpm 能正常解析预发布版。

## 快速开始

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

> ⚠️ **不能直接双击打开 `index.html`**。它引用的是 Vite 源码入口 `/src/main.js`，
> 必须经 Vite 处理（开发服务器，或 `pnpm build` 后的产物 + 静态服务器）。
> 另外 `file://` 协议下浏览器会拦截对 `otData/` 的 fetch。

## 常用命令

```bash
pnpm install                  # 安装依赖（必须用 pnpm）
pnpm dev                      # 开发服务器，内置 /otData 中间件
pnpm build                    # 构建到 dist/（自动把 otData/ 拷进去）
pnpm preview                  # 预览构建产物
pnpm test                     # 纯计算逻辑自检（不依赖浏览器）

node scripts/build-index.mjs  # 重新生成 otData/index.json
node scripts/build-index.mjs --check   # 只检查是否为最新
```

## 项目结构

```
index.html              入口 HTML（含首屏兜底 loading，样式内联）
vite.config.mjs         构建配置（Vapor 开关、vue 别名、otData 拷贝）
src/
  main.js               应用入口（createVaporApp）
  App.vue               根组件：布局 + 弹层 + 生命周期
  lib/                  纯逻辑，无 Vue 依赖，可被 Node 直接跑
    model.js            解析与统计（computeDays、summarize…）
    csv.js              CSV 解析
    data.js             数据加载：index.json + 按月 JSON + all.csv 兜底
    store.js            配置持久化（localStorage + 仓库默认值）
    icons.js            图标路径表（取自 Remix Icon）
  composables/
    useLedger.js        核心状态：加载、派生统计、视图切换、排除
    useSettings.js      设置（把非响应式的 store 包装成响应式）
    useToast.js         toast
  components/           全部 <script setup> + Vapor 组件
  styles/app.css        样式
scripts/
  selftest.mjs          纯逻辑自检
  build-index.mjs       生成 otData/index.json
  e2e*.mjs              浏览器端到端测试
  make-fixtures.mjs     生成测试用的临时站点
otData/                 打卡数据（由外部私有仓库推送，非源码）
ot-ledger.config.json   仓库默认设置（可选；构建时拷进 dist/ 供站点读取）
```

## 数据从哪来

```
punch-tracker（私有）                    my-ot-ledger（公开，本站）
  定时抓打卡                                push 到 otData/
  → YYYY-MM.json + all.csv  ──────────▶    → pnpm build（构建 dist/）
                                           → 部署 GitHub Pages
```

站点**按需读取**，不会因为历史变长而变慢：

1. `otData/index.json` —— 月份清单，约 1 KB，首屏必读
2. `otData/YYYY-MM.json` —— 按月按需加载，看某月才拉那一个月
3. `otData/all.csv` —— 兜底：`index.json` 拿不到时才会读它

「月」视图只用到当月记录，而全量 `all.csv` 的下载与解析随历史线性增长 ——
看一个月却要解析全部历史是纯浪费。所以首屏成本只与当月记录数有关；
已取到的月份缓存在内存里，来回切换不重复请求。

`index.json` 由 `scripts/build-index.mjs` 生成，部署时自动重建，
所以外部仓库即使只推了 `YYYY-MM.json` 也不会漏月份。

## 部署

推送到 `main` 分支后由 GitHub Actions 自动构建并发布到 GitHub Pages
（见 `.github/workflows/deploy-pages.yml`）。

构建产物 `dist/` **不提交到仓库**，由 CI 现场构建。workflow 里除了构建，
还有几条产物断言（必须是 Vapor 产物、必须用相对路径），防止静默回退。

## 相关文档

- [AGENTS.md](AGENTS.md) —— 给 AI 编码代理的约定与踩坑记录
