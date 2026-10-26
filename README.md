# Claude Science Local for Magpie — Windows 移植版

**无需登录 Claude 账号，直接在原版 Claude Science 中使用 Magpie 配置的模型。**

沿用你在 Magpie 中已有的模型账号和额度，支持在 Science 内自由切换模型。

非官方插件；本仓库增加 Windows 支持，保留 macOS 用法。Windows 移植版本为 `0.3.2-windows.2`。不提供模型账号或额外额度。

## Windows 安装

准备好已安装的 Windows 版 Claude Science、正在运行且至少配置一个可用模型的 Magpie，以及 Node.js 22 或 24。在没有进行中 Science 任务时安装：首次安装会停止原实例，之后桌面入口使用独立数据目录。

首次下载可在 PowerShell 中执行（示例保存在 D 盘）：

```powershell
cd D:\Project
git clone https://github.com/Jhonny1024/claude-science-local-for-magpie-windows.git
```

进入移植项目安装：

```powershell
cd D:\Project\claude-science-local-for-magpie-windows
npm ci --ignore-scripts
.\science-local.cmd install
```

按提示选默认模型；安装器会在 Magpie 注册本地 Windows 插件，无需先安装上游插件。安装后可用 `.\science-local.cmd open` 明确打开这份独立实例。路径无法自动找到时：

```powershell
.\science-local.cmd install --magpie "D:\Apps\magpie.exe" --science "D:\Apps\ClaudeScience\claude-science.exe"
```

- 运行数据、模型身份、后台日志和 Science 临时文件默认在项目的 `.science-local-runtime\`，本项目的 npm 缓存在 `work\npm-cache\`，都留在项目所在盘。
- Windows 保留必要的小型用户入口：Magpie 的配置、原 Science 配置，以及用户 Startup 目录的 `magpie-science-local.vbs`。现有 Science/Magpie 安装和历史数据不自动搬迁。
- 登录 Windows 后由用户 Startup 脚本隐藏启动，不安装系统服务。需要系统允许 Windows Script Host；企业策略禁用它时，登录自启动不可用，可手动执行 `restart`。不要为此关闭系统安全策略。
- Windows 的插件和后台程序固定到同一份本地部署；更新本项目后执行 `upgrade`，不会自动追随上游 GitHub 插件。
- 可在首次安装前设置 `SCIENCE_LOCAL_HOME` 指定另一运行目录，之后维护命令必须使用同一设置。已安装后不要直接移动项目；先卸载，再移动并重新安装。

```powershell
.\science-local.cmd open
.\science-local.cmd doctor
.\science-local.cmd upgrade
.\science-local.cmd restart
.\science-local.cmd rollback
.\science-local.cmd uninstall
```

如果再次打开跳到原版登录页，先运行 `doctor` 查看后台是否断开、安装版本是否落后。仅更新源码或重新添加 Magpie 插件不会更新后台；请执行 `upgrade`，再执行 `open`。若提示已有实例占用独立数据目录，先关闭该 Science 实例再重试，不要删除数据目录或登录文件。明确关闭 Magpie 中本 Agent 后，接入仍会断开，原版账号登录界面是恢复原配置后的正常状态。

卸载保留独立会话和模型身份，移除本插件拥有的登录入口并恢复原配置。出现用户修改冲突时会停止恢复，请根据 `doctor` 和 journal 处理。

## macOS 安装

准备好 Claude Science、正在运行的 Magpie，以及官方 [Node.js 22/24](https://nodejs.org/zh-cn/download)。Magpie 中至少有一个可用模型。

**① 在 Magpie → 插件 → 添加插件中填入：**

```text
Jhonny1024/claude-science-local-for-magpie-windows
```

**② 在终端运行，初始化本地服务：**

```sh
git clone https://github.com/Jhonny1024/claude-science-local-for-magpie-windows.git
cd claude-science-local-for-magpie-windows
npm ci --ignore-scripts
node src/cli.js install
```

已有本地旧版？最后一行改用 `node src/cli.js upgrade`，保留原有会话和配置。

按提示选一个默认模型，完成后重新打开 Science。**只在 Magpie 点击安装，还没有完成本地服务配置。**

## 使用

- **Magpie**：在本插件的 Agent 页面勾选允许使用的模型。
- **Science**：在模型菜单中选择本次对话使用哪个。
- 选中的模型失效时，自动切到默认模型；默认模型也不可用时，选列表中的第一个可用模型。已有的有效选择会保留（目前适配 Science 0.1.70）。
- 改过模型列表后，重新打开 Science 窗口。

## 更新与卸载

macOS 用户先在 Magpie 更新插件。Windows 用户保留本地部署注册，不需要在 Magpie 更新上游插件。结束任务并更新本移植项目的源码后，在项目目录运行：

```sh
npm ci --ignore-scripts
node src/cli.js upgrade
```

常用维护命令：

```sh
node src/cli.js doctor     # 查看状态
node src/cli.js rollback   # 回退上一版
node src/cli.js uninstall  # 停止后台服务，移除接入，恢复原配置
```

只在 Magpie 移除插件，不等于完整卸载后台服务。卸载不会删除本插件创建的会话。

## 需要知道

- 本地模型接入无需 Anthropic 登录，但不代表获得 Claude 订阅；云端账号功能不保证可用。
- 使用独立数据目录，不导入或删除原版 Science 的历史会话。模型费用由你选择的 Magpie 供应商计算。
- 保留原有沙箱和权限确认。macOS 运行数据在 `~/.config/magpie/science-local-runtime/`，Windows 默认在项目的 `.science-local-runtime/`，不要将其中的密钥、备份或日志公开上传。

[兼容与测试记录](COMPATIBILITY.md) · [更新记录](CHANGELOG.md)

Windows 移植基于 [nickzhangcomes/claude-science-local-for-magpie](https://github.com/nickzhangcomes/claude-science-local-for-magpie) 0.3.1；原项目基于 [shiyang1026/magpie-claude-science](https://github.com/shiyang1026/magpie-claude-science) 改造，保留 MIT 许可与原作者归属。与 Anthropic、Magpie 无隶属关系。

## 开发验证

Windows 上先让临时文件也留在项目所在盘：

```powershell
$env:TEMP = Join-Path $PWD 'work\tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
npm test
npm run check:package
```

`npm run test:integration` 使用独立 HOME 和本机模拟供应商测试真实 Magpie，需要设置 `MAGPIE_BIN` 和 `MAGPIE_BUN`。

`npm run test:windows:native` 使用独立目录启动真实 Windows Science，验证本地登录、模型目录和配置恢复；可设置 `SCIENCE_BIN`。它保留 Science 沙箱，不发送模型推理请求，诊断数据留在 `work/`。本机测试记录见 [兼容与测试记录](COMPATIBILITY.md)。
