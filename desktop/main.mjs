import { app, BrowserWindow, dialog, shell, session, ipcMain } from "electron";
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
  // Do not await readiness at ESM top level: Electron waits for module evaluation.
  app.whenReady().then(async () => {
    try {
      // A partition without "persist:" is an in-memory Electron browser session.
      const ephemeral = session.fromPartition("zemicc-runtime", {
        cache: false,
      });
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
          preload: path.join(root, "desktop", "preload.cjs"),
          session: ephemeral,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          devTools: false,
          spellcheck: false,
        },
      });
      function setZoom(value) {
        if (typeof value !== "number" || !Number.isFinite(value))
          throw new Error("Invalid zoom");
        const zoom = Math.max(0.8, Math.min(1.8, Math.round(value * 10) / 10));
        window.webContents.setZoomFactor(zoom);
        window.webContents.send("zemicc:zoom:changed", zoom);
        return zoom;
      }
      const isOwnFrame = (event) =>
        event.sender === window.webContents &&
        event.senderFrame?.url.startsWith(server.url + "/");
      ipcMain.handle("zemicc:zoom:get", (event) =>
        isOwnFrame(event) ? window.webContents.getZoomFactor() : 1,
      );
      ipcMain.handle("zemicc:zoom:set", (event, value) => {
        if (!isOwnFrame(event)) throw new Error("Invalid sender");
        return setZoom(value);
      });
      window.webContents.on("before-input-event", (event, input) => {
        if (
          input.type !== "keyDown" ||
          !(input.control || input.meta) ||
          input.alt
        )
          return;
        const plus =
          ["+", "=", "Add"].includes(input.key) || input.code === "NumpadAdd";
        const minus =
          ["-", "_", "Subtract"].includes(input.key) ||
          input.code === "NumpadSubtract";
        const reset = input.key === "0" || input.code === "Numpad0";
        if (plus || minus || reset) {
          event.preventDefault();
          setZoom(
            reset
              ? 1
              : window.webContents.getZoomFactor() + (plus ? 0.1 : -0.1),
          );
        }
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
  });
}
