# 打卡记录归档目录
#
# - YYYY-MM.json  按月归档的原始记录（脚本写入，字段见 scripts/README.md）
# - index.json    月份清单（由 scripts/build-index.mjs 生成，站点首屏只读它）
# - all.csv       由月度 JSON 汇总的平铺表（脚本自动重建）
#
# 命名/字段约定：
#   ATTDATE "yyyy-MM-dd HH:mm:ss"（北京时间）、ATTADDRESS、LOCATIONTYPE、STATUSCOLOR(RGB 数组)
#   _first_seen / _last_seen 为脚本补记的首次/最近抓到该记录的时间
#
# 两条数据来源：
#   1) 定时任务抓取（scripts/fetch_attendance.py）→ LOCATIONTYPE="工业园打卡" 等，带 ATTADDRESS/STATUSCOLOR
#   2) 手动补录（接口取不到的历史日期）        → LOCATIONTYPE="手动补录"、SOURCE="manual"、
#      ATTADDRESS/STATUSCOLOR 为空、SEQ 为该日第几次打卡（1/2/3…，时间先后顺序）
#   手动记录同样走脚本的 dedup 逻辑（键为 ATTDATE|ATTADDRESS|LOCATIONTYPE|STATUSCOLOR），
#   重复提交不会产生重复行；若日后接口能返回同期真实记录，二者会并存（可用 SOURCE 区分）。
#
# 该文件仅用于占位 + 说明约定，保证 data/attendance 目录始终存在。
#
# ---------------------------------------------------------------------------
# 站点读取顺序（重要）
#
#   1. otData/index.json          —— 只有月份清单，~1KB，首屏必读
#   2. otData/YYYY-MM.json        —— 按月按需加载（看某月才拉那一个月）
#   3. otData/all.csv             —— 兜底：index.json 拿不到时才会读它
#
# 因此 all.csv 不再是主数据源，改成按月 JSON 后站点不会因为历史变长而变慢。
# index.json 由 scripts/build-index.mjs 生成，部署 workflow 每次都会重新生成，
# 即使外部仓库只推了 YYYY-MM.json 也能得到正确的月份清单。
# ---------------------------------------------------------------------------

