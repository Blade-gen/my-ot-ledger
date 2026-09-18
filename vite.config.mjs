import { createReadStream, cpSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * 把仓库根目录的 otData/ 与 ot-ledger.config.json 原样拷进产物。
 *
 * otData 由外部私有仓库的定时任务推送更新，是「数据」而不是「源码」，
 * 所以不放进 publicDir、也不参与打包，只在构建时复制。
 * 这样 `pnpm build` 单独就能产出可部署的完整 dist/，
 * 本地预览与 CI 行为一致，不必在 workflow 里额外拼装目录。
 *
 * ot-ledger.config.json 同理必须进产物：
 *   store.loadRemote() 是按相对路径 fetch('ot-ledger.config.json') 去读它的，
 *   产物里没有这个文件就会 404 —— 而 404 是**静默忽略**的
 *   （见 store.js 的 catch），表现为「仓库默认配置明明写了却不生效」，
 *   页面上只会看到设置面板显示「未提供（可选）」，不会有任何报错。
 *   v1 的 workflow 里有 `cp ot-ledger.config.json _site/` 这一步，
 *   重写成 Vite 时漏掉了，这里补上。
 *
 * 注意是**可选**的：没有该文件时不报错，用 store.js 的内置默认值。
 */
function copyRootData() {
  return {
    name: 'ot-ledger:copy-root-data',
    apply: 'build',
    closeBundle() {
      const outDir = join(process.cwd(), 'dist');

      const dataSrc = join(process.cwd(), 'otData');
      if (existsSync(dataSrc)) {
        mkdirSync(join(outDir, 'otData'), { recursive: true });
        cpSync(dataSrc, join(outDir, 'otData'), { recursive: true });
      } else {
        this.warn('未找到 otData/，产物将不含数据目录');
      }

      const configSrc = join(process.cwd(), 'ot-ledger.config.json');
      if (existsSync(configSrc)) {
        mkdirSync(outDir, { recursive: true });
        cpSync(configSrc, join(outDir, 'ot-ledger.config.json'));
      }
    },
  };
}

/**
 * 开发服务器也要能读到 otData/。
 * otData 不在 publicDir 里（构建时才由 copyRootData 拷进产物），
 * 所以这里加一个中间件把 /otData/* 直接映射到仓库根目录，
 * 保证 `pnpm dev` 与构建后的行为一致。
 *
 * 安全：仅限开发服务器使用（apply: 'serve'）。
 * 用 resolve 后的真实路径做前缀校验，而不是字符串 contains('..') 判断，
 * 这样 %2e%2e 之类的编码绕过同样会被拦住。
 */
function serveOtDataInDev() {
  const dataRoot = resolve(process.cwd(), 'otData');

  return {
    name: 'ot-ledger:serve-otdata-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/otData/')) return next();

        let rel;
        try {
          rel = decodeURIComponent(req.url.split('?')[0].slice('/otData/'.length));
        } catch {
          return next(); // 非法百分号编码
        }

        const file = resolve(dataRoot, rel);
        // 必须仍在 otData/ 之内
        if (file !== dataRoot && !file.startsWith(dataRoot + sep)) return next();
        if (!existsSync(file) || !statSync(file).isFile()) return next();

        res.setHeader('Content-Type', contentTypeOf(file));
        res.setHeader('Cache-Control', 'no-store');
        createReadStream(file).pipe(res);
      });
    },
  };
}

function contentTypeOf(file) {
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.csv')) return 'text/csv; charset=utf-8';
  if (file.endsWith('.md')) return 'text/markdown; charset=utf-8';
  return 'application/octet-stream';
}

export default defineConfig(({ command }) => ({
  /**
   * 相对路径产物。
   * GitHub Pages 的项目站点部署在 /my-ot-ledger/ 子路径下，
   * 默认的绝对路径 /assets/... 会 404；用 './' 让产物可放在任意子目录。
   */
  base: './',
  plugins: [vue({ features: { vapor: true } }), copyRootData(), serveOtDataInDev()],
  resolve: {
    alias: [
      {
        find: /^vue$/,
        replacement:
          command === 'build'
            ? 'vue/dist/vue.runtime-with-vapor.esm-browser.prod.js'
            : 'vue/dist/vue.runtime-with-vapor.esm-browser.js',
      },
    ],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 单文件产物更省请求；图表等体积很小
    assetsInlineLimit: 4096,
  },
  server: {
    port: 5173,
  },
}));
