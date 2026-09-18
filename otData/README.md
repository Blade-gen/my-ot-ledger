# 打卡记录归档目录
#
# - YYYY-MM.json  按月归档的原始记录（脚本写入，字段见 scripts/README.md）
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
