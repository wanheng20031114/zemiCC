import { app, BrowserWindow, dialog, shell, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../dist-server/server/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
app.setName("zemiCC");
app.setPath("userData", path.join(root, ".zemicc", "desktop"));
app.commandLine.appendSwitch("disable-http-cache");
app.commandLine.appendSwitch("disable-features", "AutofillServerCommunication");
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let window, server;
  let quitting = false;
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  await app.whenReady();
  try {
    // A partition without "persist:" is an in-memory Electron browser session.
    const ephemeral = session.fromPartition("zemicc-runtime", { cache: false });
    ephemeral.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    ephemeral.setPermissionCheckHandler(() => false);
    server = await startServer({
      root,
      port: 4317,
      pickDirectory: async () => {
        const result = await dialog.showOpenDialog(window, {
          title: "打开项目",
          properties: ["openDirectory"],
        });
        return result.canceled ? undefined : result.filePaths[0];
      },
    });
    window = new BrowserWindow({
      title: "zemiCC",
      width: 1440,
      height: 960,
      minWidth: 850,
      minHeight: 650,
      backgroundColor: "#f7f8f2",
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        session: ephemeral,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        devTools: false,
        spellcheck: false,
      },
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (new URL(url).origin !== server.url) event.preventDefault();
    });
    window.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    window.once("ready-to-show", () => window.show());
    await window.loadURL(server.url);
    app.on("before-quit", (event) => {
      if (quitting) return;
      event.preventDefault();
      quitting = true;
      void server.close().finally(() => app.quit());
    });
    app.on("window-all-closed", () => app.quit());
  } catch (error) {
    dialog.showErrorBox(
      "zemiCC 启动失败",
      error?.code === "EADDRINUSE"
        ? "本机端口 4317 已被使用。请关闭正在运行的 zemiCC 或浏览器服务后重试。"
        : "请先运行 npm install 和 npm run build，再打开 zemiCC。",
    );
    await server?.close();
    app.quit();
  }
}
