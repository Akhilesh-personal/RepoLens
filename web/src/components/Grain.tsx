import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

export function Grain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const size = 256;
    canvas.width = size;
    canvas.height = size;
    const image = ctx.createImageData(size, size);
    const data = image.data;

    let frame = 0;
    let raf = 0;
    const draw = () => {
      frame += 1;
      if (frame % 3 === 0) {
        for (let i = 0; i < data.length; i += 4) {
          const v = Math.random() * 255;
          data[i] = v;
          data[i + 1] = v;
          data[i + 2] = v;
          data[i + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  if (reduced) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] h-full w-full opacity-[0.04] mix-blend-overlay"
    />
  );
}
