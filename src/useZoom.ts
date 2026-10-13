import { useCallback, useEffect, useState } from "react";

declare global {
  interface Window {
    zemiccDesktop?: {
      getZoom(): Promise<number>;
      setZoom(value: number): Promise<number>;
      onZoom(callback: (value: number) => void): () => void;
    };
  }
}
export function useZoom() {
  const [zoom, setZoom] = useState(1);
  const native = !!window.zemiccDesktop;
  const change = useCallback((value: number) => {
    const next = Math.max(0.8, Math.min(1.8, Math.round(value * 10) / 10));
    if (window.zemiccDesktop)
      void window.zemiccDesktop.setZoom(next).then(setZoom);
    else setZoom(next);
  }, []);
  useEffect(() => {
    if (window.zemiccDesktop) {
      void window.zemiccDesktop.getZoom().then(setZoom);
      return window.zemiccDesktop.onZoom(setZoom);
    }
  }, []);
  useEffect(() => {
    if (!native)
      document.documentElement.style.setProperty(
        "--browser-zoom",
        String(zoom),
      );
  }, [native, zoom]);
  useEffect(() => {
    if (native) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const plus = ["+", "="].includes(event.key) || event.code === "NumpadAdd";
      const minus =
        ["-", "_"].includes(event.key) || event.code === "NumpadSubtract";
      const reset = event.key === "0";
      if (plus || minus || reset) {
        event.preventDefault();
        change(reset ? 1 : zoom + (plus ? 0.1 : -0.1));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [native, zoom, change]);
  return { zoom, change, browserZoomed: !native && zoom > 1.2 };
}
