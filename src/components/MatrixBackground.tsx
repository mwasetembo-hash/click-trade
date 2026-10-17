import { useEffect, useRef } from "react";
import terminalGrid from "@/assets/terminal-grid.jpeg.asset.json";

/** Matrix-style falling code rain with CRT scanlines. Colors come from theme tokens. */
export function MatrixBackground() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const css = getComputedStyle(document.documentElement);
    const fg = css.getPropertyValue("--primary").trim() || "lime";
    const bg = css.getPropertyValue("--background").trim() || "black";
    const chars = "01アカサタナハマヤラワ$#@%&<>/{}[]=+*ΣΔλ";
    const size = 14;
    let cols: number[] = [], raf = 0, last = 0;
    const resize = () => { cv.width = innerWidth; cv.height = innerHeight; cols = Array(Math.ceil(innerWidth / size)).fill(0).map(() => Math.random() * -50); };
    resize(); addEventListener("resize", resize);
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 50) return; last = t;
      ctx.globalAlpha = 0.12; ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.globalAlpha = 0.55; ctx.fillStyle = fg; ctx.font = `${size}px JetBrains Mono, monospace`;
      cols.forEach((y, i) => {
        ctx.fillText(chars[(Math.random() * chars.length) | 0] ?? "0", i * size, y * size);
        cols[i] = y * size > cv.height && Math.random() > 0.975 ? 0 : y + 1;
      });
    };
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", resize); };
  }, []);
  return (
    <>
      <img src={terminalGrid.url} alt="" aria-hidden className="terminal-wallpaper pointer-events-none fixed inset-0 -z-20 h-full w-full object-cover" />
      <div aria-hidden className="terminal-backdrop pointer-events-none fixed inset-0 -z-10" />
      <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10 opacity-15" />
      <div aria-hidden className="scanlines pointer-events-none fixed inset-0 -z-10" />
    </>
  );
}
