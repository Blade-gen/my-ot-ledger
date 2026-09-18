<script setup>
import BottomSheet from './BottomSheet.vue';

defineProps({
  open: { type: Boolean, default: false },
  workdayEnd: { type: String, default: '17:30' },
  forgotCounts: { type: Boolean, default: true },
  pendingCounts: { type: Boolean, default: false },
});
</script>

<template>
  <BottomSheet :open="open" title="统计规则" @close="$emit('close')">
    <ul class="rules">
      <li><b>加班时长 = 末次打卡时间 − 标准下班时间</b>　（当前 {{ workdayEnd }}）</li>
      <li><b>一天多次打卡只取首条（上班）与末条（下班）</b>　中午的卡是早上下班卡，不参与计算</li>
      <li>
        <b>末次打卡早于标准下班时间</b>　视为忘打卡，当天加班记 0；
        <template v-if="forgotCounts">计入平均</template>
        <template v-else>不计入平均</template>
      </li>
      <li><b>打卡次数不足</b>　视为数据不足，不纳入统计</li>
      <li>
        <b>今天还没结束（没有任何打卡，或还没打下班卡）</b>
        <template v-if="pendingCounts">　暂按 0 加班计入平均，避免月初日均偏高</template>
        <template v-else>　暂不纳入统计</template>
      </li>
      <li><b>平均加班 = 加班总时长 ÷ 有效统计天数</b>　被排除的日期不参与任何汇总</li>
      <li><b>明细表最后一列用于勾选排除</b>　再次点击即恢复纳入统计</li>
      <li><b>图表中被排除的灰柱按平均值示意高度</b>　灰柱高度不代表当天真实加班时长</li>
    </ul>
    <p class="sheet-note">规则来自当前设置，在「设置」里修改后即时生效。</p>
  </BottomSheet>
</template>
