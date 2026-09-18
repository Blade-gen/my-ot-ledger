/**
 * 设置：仓库默认配置 + 本机覆盖（localStorage），合并后生效。
 *
 * 注意（踩过的坑）：
 *   store 是普通对象，store.local / store.remoteFound 都不是响应式的。
 *   写成 computed(() => store.hasLocal()) 会得到一个**永远不变的缓存值**
 *   （computed 没有任何响应式依赖 → 只求值一次就永久缓存），
 *   于是保存后页脚仍显示「无本机修改」。
 *   所以这里用真正的 ref，并在每个会改动 store 的操作里显式同步。
 */
import { ref } from 'vue';
import { store } from '../lib/store.js';

const cfg = ref(store.get());
const hasLocal = ref(false);
const remoteFound = ref(false);

export function useSettings() {
  /** 把 store 的内部状态同步到响应式引用 */
  function sync() {
    cfg.value = store.get();
    hasLocal.value = store.hasLocal();
    remoteFound.value = store.remoteFound;
  }

  return {
    cfg,
    hasLocal,
    remoteFound,

    init() {
      store.init();
      sync();
    },

    /** 拉取仓库级默认配置（可选，失败静默忽略） */
    async loadRemote() {
      await store.loadRemote();
      sync();
    },

    /** 写入本机覆盖 */
    save(patch) {
      store.save(patch);
      sync();
      return cfg.value;
    },

    reset() {
      store.reset();
      sync();
      return cfg.value;
    },

    exportConfig() {
      return store.exportConfig();
    },
  };
}
