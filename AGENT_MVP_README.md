# 电商运营智能体 MVP

这是从 `shop_login_center` 复制出的独立改造项目。

- 原项目：`shop_login_center`，作为稳定版保留
- 本项目：`shop_login_agent_mvp`，后续只在这里开发 Agent 能力
- 已保留：店铺 Profile、登录状态、CDP/Playwright、平台采集、历史报表
- 已增加：AI 运营助手、销售汇总工具、LangGraph 服务骨架

启动前在本目录安装依赖：

```powershell
npm install
npm start
```

后续 LangGraph 和复杂数据分析也只接入本项目，不修改原项目。
