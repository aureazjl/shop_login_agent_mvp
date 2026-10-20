# 电商运营智能体 MVP

一个面向电商运营人员的本地桌面智能体。项目把店铺登录、销售数据采集、数据汇总和自然语言查询放在同一个 Electron 客户端中，并通过 LangGraph 编排“理解需求 → 选择店铺 → 检查登录 → 采集数据 → 重试 → 汇总回答”的完整链路。

本项目是独立于原 shop_login_center 的改造版本，当前代码位于 shop_login_agent_mvp。

## 项目定位

用户不需要分别打开浏览器、数据工具和分析工具，而是在客户端中直接提出运营问题，例如：

~~~text
查询昨天所有已登录店铺的销售额、退款金额和净销售额
~~~

智能体负责将问题转换成采集任务，调用本地店铺工具完成登录检查和数据采集，再把多店铺结果汇总为可读的运营结论。

## 已实现内容

### 1. Electron 桌面客户端

- 店铺账号管理、登录检查、数据采集、销售/退款报表和业绩分析页面；
- AI 运营助手入口；
- 本地运行，不依赖公网业务中转服务；
- Electron 单实例保护，避免多个客户端抢占本地桥接端口。

### 2. 多平台店铺接入

当前已接入或预留：

- 抖音电商/抖店：支持销售额、退款金额和退款订单采集；
- 京东商智：接入登录检查和数据采集链路；
- 淘宝/天猫生意参谋：接入登录检查和销售数据采集链路；
- 得物商家后台：接入登录检查和商品分析数据采集链路；
- 拼多多：保留平台配置和扩展入口。

店铺使用独立 profile 目录，避免不同店铺之间串号。登录、扫码、验证码等敏感步骤保留人工完成，不在代码中保存明文账号密码。

### 3. LangGraph 智能体流程

Python 服务位于 agent_service/，当前图结构包括：

~~~text
解析用户请求
    ↓
确定目标日期和店铺范围
    ↓
读取店铺清单
    ↓
逐店铺检查登录状态
    ↓
调用 Electron 本地采集工具
    ↓
失败重试与错误记录
    ↓
按平台和店铺汇总
    ↓
生成运营回答
~~~

LangGraph 负责任务编排和状态流转，Electron 负责浏览器、登录态和平台页面操作。两者通过本机 HTTP 桥接通信：

~~~text
LangGraph 服务 → 127.0.0.1:18769 → Electron 店铺工具 → 平台后台
~~~

本地桥接接口：

- GET /agent/shops：读取店铺清单；
- POST /agent/check-login：检查指定店铺登录状态；
- POST /agent/collect-sales：采集指定店铺指定日期的销售数据。

### 4. 真实数据采集与汇总

系统按日期执行店铺级采集，统一输出店铺、平台、日期、销售额、退款金额、退款订单数、净销售额、采集时间及失败原因。LangGraph 会跳过未登录店铺，并记录失败店铺，不因单个店铺失败而中断全部任务。

## 技术栈

- 客户端：Electron、HTML、CSS、原生 JavaScript；
- 浏览器自动化：Playwright；
- 智能体编排：Python、LangGraph；
- 本地通信：Node.js HTTP Server；
- 数据存储：本地 JSON、SQLite 和运行时 profile；
- 打包：electron-builder；
- 运行环境：Windows 10/11。

## 启动方式

### 启动 Electron 客户端

~~~powershell
cd path\to\shop_login_agent_mvp
npm install
npm start
~~~

项目已配置本地 Electron 运行时路径，正常情况下不会再次下载 Electron 二进制文件。

### 安装并启动 LangGraph 服务

~~~powershell
cd path\to\shop_login_agent_mvp\agent_service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python agent_service.py
~~~

先启动 Electron 客户端，再启动 LangGraph 服务。Electron 必须先监听 127.0.0.1:18769，智能体才能调用店铺工具。

## 登录和风控边界

- 淘宝、京东、得物等平台登录需要用户在客户端打开的店铺浏览器中人工完成；
- 不自动输入密码、短信验证码或绕过验证码；
- 不把登录 cookie、浏览器 profile、token 或店铺数据提交到 Git；
- 淘宝登录优先复用本机 Google Chrome 店铺目录，避免切换到 Electron 内嵌浏览器造成额外风控；
- data_runtime/、electron-user-data/、浏览器 profile 和缓存均已加入 .gitignore。

## 当前已验证链路

1. Electron 启动并提供店铺管理界面；
2. Electron 本地桥接服务启动在 18769 端口；
3. LangGraph 能读取店铺列表并解析日期；
4. LangGraph 能逐店铺调用登录检查和销售采集；
5. 抖音多店铺销售额、退款金额和净销售额能够汇总；
6. 单个店铺失败不会阻断其他店铺采集；
7. Electron 客户端具备单实例保护。

## 后续更新计划

### 第一阶段：稳定性

- 完善淘宝、京东和得物的登录状态识别；
- 增加平台连接诊断页，展示浏览器、profile、端口和最近错误；
- 增加采集任务队列、超时控制和断点续采；
- 增加统一日志和可导出的任务执行记录；
- 增加单元测试和真实店铺回归测试。

### 第二阶段：运营智能体

- 支持按店铺、平台、日期和指标的自然语言筛选；
- 支持销售额、退款率、客单价、转化率等指标计算；
- 增加销售额突降、退款异常和店铺未登录检测；
- 支持自动生成日报、周报和店铺对比报告；
- 增加人工确认节点，避免智能体直接执行高风险操作。

### 第三阶段：数据和产品化

- 建立统一数据模型和本地历史数据仓库；
- 支持 Excel、CSV 和数据库导入；
- 增加任务调度和定时采集；
- 支持权限、操作审计和多用户工作区；
- 将平台采集器抽象为可插拔工具；
- 增加报表导出、图表分析和运营建议卡片。

## 目录结构

~~~text
shop_login_agent_mvp/
├─ main.js                    # Electron 主进程、店铺工具和本地桥接
├─ preload.js                 # 渲染进程安全 API
├─ renderer/                  # 客户端界面
├─ agent_service/
│  ├─ agent_service.py        # LangGraph 智能体服务
│  ├─ requirements.txt        # Python 依赖
│  └─ README.md               # 智能体服务说明
├─ package.json               # Electron 依赖和启动脚本
├─ package-lock.json
└─ .gitignore                 # 登录态、缓存和构建产物排除规则
~~~

## 注意事项

本项目是本地电商运营自动化 MVP，不承诺绕过任何平台的安全验证或风控机制。平台页面、接口和登录规则可能变化，生产使用前应针对每个平台建立独立的回归测试和异常处理策略。
