/**
 * 轻量 toast：全局单例，1.8s 后自动消失。
 */
import { onUnmounted, ref } from 'vue';

const message = ref('');
const visible = ref(false);
let timer = null;
let hideTimer = null;

export function useToast() {
  function toast(text) {
    message.value = text;
    visible.value = true;
    clearTimeout(timer);
    clearTimeout(hideTimer);
    timer = setTimeout(() => {
      visible.value = false;
      // 等淡出动画结束再清空文字，避免退场时文字先消失
      hideTimer = setTimeout(() => {
        message.value = '';
      }, 200);
    }, 1800);
  }

  onUnmounted(() => {
    clearTimeout(timer);
    clearTimeout(hideTimer);
  });

  return { message, visible, toast };
}
