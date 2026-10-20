# LangGraph Agent MVP

这是电商运营客户端的可选 Python Agent 服务入口。当前 Electron 内置了同等的本地销售查询工具，保证不安装 Python 也能运行客户端 MVP。

当需要复杂多步骤分析时，安装依赖并启动：

```powershell
python -m pip install -r requirements.txt
python agent_service.py
```

设计边界：LangGraph 负责编排；Electron 负责店铺 Profile 和平台采集；Python 数据层负责复杂计算。
