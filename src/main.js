/**
 * 应用入口
 *
 * 必须用 createVaporApp（不是 createApp）：'vue' 已在 vite.config.mjs 里
 * 别名到带 vapor 的运行时入口，Vapor 组件只能挂在 vapor 应用上。
 *
 * 注意：index.html 里的首屏兜底遮罩（#boot-loading）**不在这里删除**，
 * 而是交给 LoadingOverlay 组件的 onMounted —— 那样才能保证
 * 「Vue 的遮罩已进 DOM」之后再移除兜底，中间不留空帧。
 */
import { createVaporApp } from 'vue';
import App from './App.vue';
import './styles/app.css';

createVaporApp(App).mount('#app');
