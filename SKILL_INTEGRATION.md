# Skill 调用店铺登录目录

客户端会把店铺注册表保存到 `D:\店铺登录客户端数据\shops.json`，每个店铺的浏览器用户目录为：

`D:\店铺登录客户端数据\profiles\<shop_id>`

Skill 不要根据店铺名称拼路径，应先查询注册表：

```powershell
python shop_registry.py list
python shop_registry.py profile --id <shop_id>
```

`profile` 返回 `profile_dir`、`platform`、`status`、`login_url`。抓取任务据此调用 Playwright 的 `launch_persistent_context(profile_dir)`。

同一个店铺目录同一时间只允许一个浏览器任务占用。推荐任务完成后关闭 context；如果已有客户端登录窗口打开，应复用该窗口或等待它关闭。

## 抖店昨日成交和退款

使用客户端注册表中的 `shop_id` 调用：

```powershell
node douyin_yesterday_metrics.mjs <shop_id>
```

脚本使用后台 Playwright，不显示浏览器窗口，返回标准 JSON：

```json
{
  "shop_id": "...",
  "date": "2026-09-18",
  "sales_amount": 745,
  "refund_amount": 436.1,
  "refund_amount_by_payment_time": 0
}
```

其中 `sales_amount` 是昨日成交金额，`refund_amount` 是按退款时间口径的昨日退款金额。
