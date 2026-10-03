import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

interface ParticlesProps {
  className?: string;
  quantity?: number;
  staticity?: number;
  ease?: number;
  size?: number;
  refresh?: boolean;
  color?: string;
  vx?: number;
  vy?: number;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let cleanHex = hex.replace("#", "");
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split("")
      .map((char) => char + char)
      .join("");
  }
  const int = parseInt(cleanHex, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

interface Circle {
  x: number;
  y: number;
  translateX: number;
  translateY: number;
  size: number;
  alpha: number;
  targetAlpha: number;
  dx: number;
  dy: number;
  magnetism: number;
}

export const Particles: React.FC<ParticlesProps> = ({
  className,
  quantity = 60,
  staticity = 50,
  ease = 50,
  size = 0.5,
  refresh = false,
  color = "#ffffff",
  vx = 0,
  vy = 0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const context = useRef<CanvasRenderingContext2D | null>(null);
  const circles = useRef<Circle[]>([]);
  const mouse = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const canvasSize = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const isVisible = useRef<boolean>(false);
  const animFrameId = useRef<number | null>(null);
  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;

  useEffect(() => {
    const rgb = hexToRgb(color);

    const initCanvas = () => {
      resizeCanvas();
      drawParticles();
    };

    const resizeCanvas = () => {
      if (canvasContainerRef.current && canvasRef.current && context.current) {
        circles.current.length = 0;
        canvasSize.current.w = canvasContainerRef.current.offsetWidth;
        canvasSize.current.h = canvasContainerRef.current.offsetHeight;
        canvasRef.current.width = canvasSize.current.w * dpr;
        canvasRef.current.height = canvasSize.current.h * dpr;
        canvasRef.current.style.width = `${canvasSize.current.w}px`;
        canvasRef.current.style.height = `${canvasSize.current.h}px`;
        context.current.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };

    const circleParams = (): Circle => {
      const x = Math.floor(Math.random() * (canvasSize.current.w || 400));
      const y = Math.floor(Math.random() * (canvasSize.current.h || 400));
      const translateX = 0;
      const translateY = 0;
      const pSize = Math.floor(Math.random() * 2) + size;
      const alpha = 0;
      const targetAlpha = parseFloat((Math.random() * 0.6 + 0.1).toFixed(1));
      const dx = (Math.random() - 0.5) * 0.2;
      const dy = (Math.random() - 0.5) * 0.2;
      const magnetism = 0.1 + Math.random() * 4;
      return {
        x,
        y,
        translateX,
        translateY,
        size: pSize,
        alpha,
        targetAlpha,
        dx,
        dy,
        magnetism,
      };
    };

    const drawCircle = (circle: Circle, update = false) => {
      if (context.current) {
        const { x, y, translateX, translateY, size: circleSize, alpha } = circle;
        context.current.translate(translateX, translateY);
        context.current.beginPath();
        context.current.arc(x, y, circleSize, 0, 2 * Math.PI);
        context.current.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
        context.current.fill();
        context.current.setTransform(dpr, 0, 0, dpr, 0, 0);

        if (!update) {
          circles.current.push(circle);
        }
      }
    };

    const clearContext = () => {
      if (context.current) {
        context.current.clearRect(
          0,
          0,
          canvasSize.current.w,
          canvasSize.current.h
        );
      }
    };

    const drawParticles = () => {
      clearContext();
      const particleCount = quantity;
      for (let i = 0; i < particleCount; i++) {
        const circle = circleParams();
        drawCircle(circle);
      }
    };

    const remapValue = (
      value: number,
      start1: number,
      end1: number,
      start2: number,
      end2: number
    ): number => {
      const remapped =
        ((value - start1) * (end2 - start2)) / (end1 - start1) + start2;
      return remapped > 0 ? remapped : 0;
    };

    const animate = () => {
      clearContext();
      circles.current.forEach((circle: Circle, i: number) => {
        const edge = [
          circle.x + circle.translateX - circle.size,
          canvasSize.current.w - circle.x - circle.translateX - circle.size,
          circle.y + circle.translateY - circle.size,
          canvasSize.current.h - circle.y - circle.translateY - circle.size,
        ];
        const closestEdge = edge.reduce((a, b) => Math.min(a, b));
        const remapLogarithm = remapValue(
          closestEdge,
          0,
          20,
          0,
          1
        );
        if (remapLogarithm > 1) {
          circle.alpha += 0.02;
          if (circle.alpha > circle.targetAlpha) {
            circle.alpha = circle.targetAlpha;
          }
        } else {
          circle.alpha = circle.targetAlpha * remapLogarithm;
        }
        circle.x += circle.dx + vx;
        circle.y += circle.dy + vy;
        circle.translateX +=
          (mouse.current.x / (staticity / circle.magnetism) - circle.translateX) /
          ease;
        circle.translateY +=
          (mouse.current.y / (staticity / circle.magnetism) - circle.translateY) /
          ease;

        if (
          circle.x < -circle.size ||
          circle.x > canvasSize.current.w + circle.size ||
          circle.y < -circle.size ||
          circle.y > canvasSize.current.h + circle.size
        ) {
          circles.current.splice(i, 1);
          const newCircle = circleParams();
          drawCircle(newCircle);
        } else {
          drawCircle(
            {
              ...circle,
              x: circle.x,
              y: circle.y,
              translateX: circle.translateX,
              translateY: circle.translateY,
              alpha: circle.alpha,
            },
            true
          );
        }
      });
    };

    if (canvasRef.current) {
      context.current = canvasRef.current.getContext("2d");
    }
    initCanvas();

    const animateLoop = () => {
      if (!isVisible.current) {
        animFrameId.current = null;
        return;
      }
      animate();
      animFrameId.current = window.requestAnimationFrame(animateLoop);
    };

    const startAnimation = () => {
      if (!animFrameId.current && isVisible.current) {
        animFrameId.current = window.requestAnimationFrame(animateLoop);
      }
    };

    const stopAnimation = () => {
      if (animFrameId.current) {
        window.cancelAnimationFrame(animFrameId.current);
        animFrameId.current = null;
      }
    };

    const target = canvasContainerRef.current;
    let observer: IntersectionObserver | null = null;
    if (target && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        ([entry]) => {
          isVisible.current = entry.isIntersecting;
          if (entry.isIntersecting) {
            startAnimation();
          } else {
            stopAnimation();
          }
        },
        { rootMargin: "100px" }
      );
      observer.observe(target);
    } else {
      isVisible.current = true;
      startAnimation();
    }

    let resizeTimer: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        initCanvas();
      }, 150);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(resizeTimer);
      if (observer) observer.disconnect();
      stopAnimation();
    };
  }, [color, quantity, staticity, ease, size, refresh, vx, vy, dpr]);

  return (
    <div
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      ref={canvasContainerRef}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} />
    </div>
  );
};
