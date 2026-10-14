# SLA 与提醒操作

按新加坡时间计算。默认工作日历为周一至周五 09:00–18:00，1 SLA 天为 9 工作小时，排除配置的节假日；自然日模式为连续 24 小时。未开始节点不计时；整轮无活跃或暂停节点时，仅首个待开始阶段中开启提醒的节点显示普通“待启动/待登记”，不标逾期、不展示后续阶段。关闭首阶段提醒不改为提示后续阶段，等待成本确认也不能隐藏待启动任务。已开始节点在 SLA 内普通提醒，最后一日马上处理，超过精确 dueAt 为紧急。可设更早 followUpDate。暂停期间停止一般提醒，到恢复安排日期提示恢复；关闭节点提醒不解除关键节点或成本门禁。

```sh
cost-cli digest generate --as-of YYYY-MM-DD
cost-cli reminders scan --as-of YYYY-MM-DD
cost-cli reminders list
cost-cli reminders ack --id ID --fingerprint RETURNED_FINGERPRINT
```

以上是全局入口，无 project-id；按结果筛选。每个活跃节点可有一条提醒，Today 按项目汇总最高紧急程度。ack 仅标已阅；状态更新使提醒退出。API 运行时扫描，skill 不会后台常驻，也不代表已联系 PM；未授权不发消息。
