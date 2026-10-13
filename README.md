# zemiCC

<img src="desktop/assets/icon.svg" width="88" height="88" alt="zemiCC" />

**A little space. A big idea.**

一个安静、清爽的 Claude Agent SDK 桌面工作区。打开项目，输入自己的 API key，开始创造。

zemiCC is an independent desktop interface for the official Claude Agent SDK. It is not an official Anthropic application.

## 使用

Windows 10/11 x64 用户请从 [GitHub Releases](https://github.com/wanheng20031114/zemiCC/releases/latest) 下载：

- **安装版** `zemiCC-Setup-版本-x64.exe`：安装后使用桌面或开始菜单的 zemiCC，可右键任务栏图标固定。
- **免安装版** `zemiCC-版本-win-x64.zip`：解压到固定目录，双击 `zemiCC.exe`；不能只移动其中一个 EXE。

应用已内置桌面与 Claude Agent 运行时，无需另外安装 Node.js、npm 或全局 Claude Code。项目自己的编译器、Git 等开发工具仍需安装；Windows shell 工具建议安装 [Git for Windows](https://gitforwindows.org/)。

当前安装包未签名，Windows 可能显示未知发布者提示。Release 附有 `SHA256SUMS.txt`，可用 PowerShell 的 `Get-FileHash 文件名 -Algorithm SHA256` 核对下载内容。

1. 选择项目文件夹。
2. 点击左下角的连接按钮，在应用内输入自己的 Anthropic API key。
3. 描述任务。默认「智能自动」模式下，普通文件读写与源码搜索直接执行，命令由 SDK 自动审核。

输入框左下角的图片按钮支持多选，也可以直接粘贴截图或将图片拖入输入框。缩略图可预览、移除；可以只发图片，也能在任务运行时补充图片。每条消息最多 5 张，支持 PNG、JPEG、WebP、GIF（首帧），原文件每张最多 20 MB / 4000 万像素；添加时自动校正方向、移除额外元数据，较大图片缩至最长边 2560 像素。发送后的图片可点击放大。

输入框右下角可随时切换「智能自动」与「逐次确认」。选择会保存，应用于当前对话的后续操作及新对话，已经显示的确认请求仍需处理。SDK 根据完整命令及任务上下文判断风险，zemiCC 不再仅因命令包含 `../`、删除关键词或后台标记就强制弹窗。需要人工授权的请求会显示确认卡片与原因；凭据相关命令仍保留额外确认。敏感文件与项目外文件工具访问保持受限，Agent 的问题仍由你回答。

Agent 工作时也可以继续输入，点击发送箭头或按 Enter 补充到当前任务。消息通过 SDK 的连续输入通道送达，在工具调用间隙或下一次回复中处理，不用先停止。停止按钮会中断任务并取消尚未送达的补充消息；未送达内容会保留在对话中供重新编辑，但不会自动恢复发送。模型选择也可编辑，新选择在下一条消息发送时传给 SDK。

命令审核使用官方 SDK 的 [`auto` 权限模式](https://code.claude.com/docs/en/permission-modes#eliminate-permission-prompts-with-auto-mode)。如账户、模型或服务暂不支持，会显示降级提示并对命令请求确认。自动审核模型可能产生额外 API 费用，界面的费用估算不包含所有审核调用。

长任务不设应用层轮数或金额上限。zemiCC 不传入 SDK 的 `maxTurns` 或 `maxBudgetUsd`，任务可持续执行；你可以随时点击停止。API 服务的额度、速率限制及网络错误仍可能中断执行，费用按实际使用产生。

右上角 `− / 100% / +` 可缩放整个界面（80%–180%）。也支持 `Ctrl + +`、`Ctrl + =`、`Ctrl + −` 和 `Ctrl + 0` 复位；macOS 使用 Command。

## MCP 服务器

点击左侧 **MCP 服务器**，添加本地命令（stdio）、远程 HTTP（Streamable HTTP）或 SSE 服务。也可以直接导入服务提供方给出的标准 `{"mcpServers": {...}}` JSON；同名配置会更新。

- **测试连接**检查服务并列出工具，不调用工具，也不需要 Claude API key。「可用」表示最近一次检查成功。
- MCP 可以随时编辑、测试或启停。配置立即保存；运行中的任务继续使用现有连接，任务结束且没有排队消息时更新连接，SDK 对话上下文会保留。界面会提示尚待应用的改动。
- MCP 工具沿用当前权限模式：「智能自动」交给 SDK 审核，需要时才显示人工确认；「逐次确认」逐次询问。
- `env` 与 `headers` 的值只留在内存。重启后，带凭据的服务会显示「待填写凭据」；进入编辑补齐即可。同一次运行中，已有字段留空表示保留值，删除字段则移除它。

本地服务需要自己的运行环境，例如 `npx` 需要 Node.js，`uvx` 需要 uv。Windows 上若 `npx` 无法直接启动，可按服务说明使用 `cmd`，参数形如 `["/c", "npx", "-y", "服务包名"]`。保存不会启动命令，测试连接或发送任务时才会运行。

远程服务可填写 `Authorization` 等请求头；目前未提供浏览器 OAuth 登录流程，需要这类登录的服务会显示「需要认证」。远程地址需使用 HTTPS，本机地址可使用 HTTP。不会自动读取 Claude 全局或项目中的 MCP 配置，请在应用中明确添加。

只接入你信任的服务器。本地 MCP 进程使用当前用户的系统权限；远程 MCP 会收到调用参数及相关数据。将密钥放入专用环境变量或请求头字段，不要写进会保存到磁盘的名称、命令、参数或 URL。

## 已实现

- 真实 Claude Agent SDK 工具循环、流式回复、停止生成、多轮对话，无应用层轮数或金额截断。
- Opus 5.5 / Haiku 5.5 模型选择（可用性和额度由你的 API 账户决定）。
- 自动 / 逐次确认权限模式，高风险操作说明，支持 Agent 的选择题与自由回答。
- 原生 MCP 服务器管理、JSON 导入、连接测试和工具发现，支持 stdio / HTTP / SSE。
- 项目文件树、文本预览、Git 状态和差异预览。
- 本地会话历史，累计用量和费用估算。
- 图片选择、拖放与剪贴板粘贴，支持纯图片消息、运行中补图、历史图片预览及恢复。
- 独立 Windows 安装包、应用图标和任务栏固定；自适应界面、键盘发送、减少动画偏好。

## 密钥与数据

**zemiCC 不保存 API key。** 密钥只通过密码输入框进入本机后端内存，以及执行任务所需的 SDK 子进程环境；退出进程后需要重新输入。不会写入 `.env`、配置、浏览器存储或会话文件，也不会提交到仓库。SDK 仅直连 `https://api.anthropic.com`；不支持转发站，不伪装官方客户端。

MCP 的公开连接配置和凭据字段名称保存到同一数据目录下的 `mcp-servers.json`，`env` / `headers` 的值不保存。配置通过 SDK 控制通道传递，不写入临时 MCP 配置文件或命令行参数。MCP 子进程默认不继承 zemiCC 的 Claude API key。

项目路径及脱敏后的会话保存在 `%APPDATA%\zemiCC\workspace\workspace.json`，更新应用时保留；开发模式使用仓库内已被 Git 忽略的 `.zemicc/workspace.json`。SDK 原始会话持久化已关闭。进程运行时，多轮对话共享同一 SDK 上下文；应用重启、停止或更换 key 后，继续会话会将最近 60,000 字符的用户/助手记录作为上下文交给新的 SDK 会话，因此旧工具状态和更早的内容可能不完整。

处理后的图片保存在同一数据目录的 `images/` 中，历史记录仅保存图片引用。发送时以 SDK 原生图片块交给 Anthropic；仅添加到草稿不会发给模型。重启后恢复最近的图片上下文，连同本次图片最多 5 张，其余历史图仍可在界面查看并重新添加。未发送的图片在下次启动时清理；删除会话会清理未被其他会话引用的图片。图片像素不会自动脱敏，请在截图前遮住密钥等敏感内容。

权限审核**不是操作系统沙箱**。自动审核通过或由你批准的命令使用当前用户的系统权限，可以访问磁盘、进程环境和网络。只对信任的项目执行任务；审核并不保证识别所有危险行为。不要把密钥放进聊天或项目文件。详见 [SECURITY.md](SECURITY.md)。

## 开发与验证

开发需要 Node.js 22.17+。源码启动方式：

```sh
npm ci
npm test
npm run build
npm run desktop
```

`启动 zemiCC.vbs` 仅用于源码开发，不应固定到任务栏。可选浏览器模式：`npm start`，打开 `http://127.0.0.1:4317`；关闭页面不会关闭服务，退出服务后才会释放密钥。

`npm run dev` 通过 tsx 运行后端（前端改动后需重新构建）。服务默认只绑定 `127.0.0.1:4317`，可用 `ZEMICC_PORT` 和 `ZEMICC_DATA_DIR` 修改端口与本地数据目录。桌面模式使用 4317。

在 Windows x64 上运行 `npm run dist:win` 可构建安装包、ZIP 与校验文件，输出到已被 Git 忽略的 `release/`。`npm run verify:package` 检查应用文件、运行时完整性及用户数据排除。发布版本时，先更新 `package.json` / lockfile 的版本及 `docs/releases/v版本.md`，再推送同版本的 `v*` Git tag；Windows Release 工作流将测试、构建、实际启动程序，再上传 GitHub Release。二进制通过 Releases 分发，不提交进源码历史。

React + TypeScript + Vite · Express · Electron · Claude Agent SDK

zemiCC 源码采用 MIT License；捆绑组件保留各自许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。API 使用产生的费用及适用政策由你的 API 提供方决定。
