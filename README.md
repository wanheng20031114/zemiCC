# zemiCC

**A little space. A big idea.**

一个安静、清爽的 Claude Agent SDK 桌面工作区。打开项目，输入自己的 API key，开始创造。

zemiCC is an independent desktop interface for the official Claude Agent SDK. It is not an official Anthropic application.

## 使用

需要 Node.js 22+；Windows 还需要 [Git for Windows](https://gitforwindows.org/)（Agent 的 shell 工具依赖 Git Bash 或 PowerShell）。

```sh
npm ci
npm run build
npm run desktop
```

Windows 安装依赖并构建后，也可双击 `启动 zemiCC.vbs`，直接打开桌面窗口。

1. 选择项目文件夹。
2. 点击左下角的连接按钮，在应用内输入自己的 Anthropic API key。
3. 描述任务。文件写入、搜索和命令会显示独立的确认卡片。

右上角 `− / 100% / +` 可缩放整个界面（80%–180%）。也支持 `Ctrl + +`、`Ctrl + =`、`Ctrl + −` 和 `Ctrl + 0` 复位；macOS 使用 Command。

可选浏览器模式：`npm start`，打开 `http://127.0.0.1:4317`。浏览器模式下关闭页面不会关闭服务；退出服务后才会释放密钥。

## 已实现

- 真实 Claude Agent SDK 工具循环、流式回复、停止生成、多轮对话。
- Opus 5.5 / Haiku 5.5 模型选择（可用性和额度由你的 API 账户决定）。
- 命令和文件变更逐次确认，支持 Agent 的选择题与自由回答。
- 项目文件树、文本预览、Git 状态和差异预览。
- 本地会话历史，累计用量和费用估算。
- 独立 Electron 桌面窗口；自适应界面、键盘发送、减少动画偏好。

## 密钥与数据

**zemiCC 不保存 API key。** 密钥只通过密码输入框进入本机后端内存，以及执行任务所需的 SDK 子进程环境；退出进程后需要重新输入。不会写入 `.env`、配置、浏览器存储或会话文件，也不会提交到仓库。SDK 仅直连 `https://api.anthropic.com`；不支持转发站，不伪装官方客户端。

项目路径及脱敏后的会话保存在本地 `.zemicc/workspace.json`；该目录已被 Git 忽略。SDK 原始会话持久化已关闭。进程运行时，多轮对话共享同一 SDK 上下文；应用重启、停止或更换 key 后，继续会话会将最近 60,000 字符的用户/助手记录作为上下文交给新的 SDK 会话，因此旧工具状态和更早的内容可能不完整。

审批是用户授权界面，**不是操作系统沙箱**。批准的命令使用当前用户的系统权限，可以访问磁盘、进程环境和网络。只对信任的项目执行任务，审批前检查命令；不要把密钥放进聊天或项目文件。详见 [SECURITY.md](SECURITY.md)。

## 开发与验证

```sh
npm test
npm run check
npm run build
```

`npm run dev` 通过 tsx 运行后端（前端改动后需重新构建）。服务默认只绑定 `127.0.0.1:4317`，可用 `ZEMICC_PORT` 和 `ZEMICC_DATA_DIR` 修改端口与本地数据目录。桌面模式使用 4317。

React + TypeScript + Vite · Express · Electron · Claude Agent SDK

MIT License. API 使用产生的费用及适用政策由你的 API 提供方决定。
