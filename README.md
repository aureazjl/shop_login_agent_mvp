# 店铺登录中心（第一期）

## 启动

在工作区根目录运行：

```powershell
python .\shop_login_center\app.py
```

浏览器打开：`http://127.0.0.1:18766`

## 当前功能

- SQLite 店铺登记；
- 独立 profile 目录：`shop_login_center/data/profiles/<shop_id>`；
- 店铺状态总览；
- 店铺状态筛选统计；
- 手动健康检查；
- 新增店铺后自动启动可见 Playwright 登录窗口；
- 账号标识防串店基础检查；
- 审计日志和健康检查记录；
- 未安装 Playwright 时仍可管理店铺，但健康检查会明确显示依赖缺失。

## 安装浏览器检查依赖

如需真实启动 Chromium 检查登录状态：

```powershell
python -m pip install playwright
python -m playwright install chromium
```

新增店铺或点击“登录”会启动独立的可见浏览器窗口。完成扫码/密码登录后，回到管理页面点击“检查”。

安装依赖前请先确认当前 Python 环境和网络条件。第一期不会自动输入账号密码，首次登录/扫码/短信验证保留人工完成。

## 注意

`data/profiles` 是登录身份数据，不要提交 Git、上传网盘或复制到不受控目录。
