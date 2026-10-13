const { contextBridge, ipcRenderer } = require("electron");

// Expose only display scaling; the renderer receives no filesystem or credential access.
contextBridge.exposeInMainWorld("zemiccDesktop", {
  getZoom: () => ipcRenderer.invoke("zemicc:zoom:get"),
  setZoom: (value) => ipcRenderer.invoke("zemicc:zoom:set", value),
  onZoom: (callback) => {
    const listener = (_event, value) => {
      if (typeof value === "number") callback(value);
    };
    ipcRenderer.on("zemicc:zoom:changed", listener);
    return () => ipcRenderer.removeListener("zemicc:zoom:changed", listener);
  },
});
