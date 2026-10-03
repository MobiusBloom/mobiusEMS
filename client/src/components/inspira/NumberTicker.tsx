import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface NumberTickerProps {
  value: number;
  direction?: "up" | "down";
  delay?: number; // in seconds
  duration?: number; // in seconds
  decimalPlaces?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

export const NumberTicker: React.FC<NumberTickerProps> = ({
  value,
  direction = "up",
  delay = 0,
  duration = 1.6,
  decimalPlaces = 0,
  prefix = "",
  suffix = "",
  className,
}) => {
  const [displayValue, setDisplayValue] = useState<number>(
    direction === "down" ? value : 0
  );
  const elementRef = useRef<HTMLSpanElement>(null);
  const hasAnimated = useRef<boolean>(false);

  useEffect(() => {
    const runAnimation = () => {
      const startTime = performance.now() + delay * 1000;
      const totalDuration = duration * 1000;
      const startVal = direction === "down" ? value : 0;
      const endVal = direction === "down" ? 0 : value;

      const tick = (currentTime: number) => {
        if (currentTime < startTime) {
          requestAnimationFrame(tick);
          return;
        }
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / totalDuration, 1);

        // easeOutExpo
        const easeProgress =
          progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);

        const current = startVal + (endVal - startVal) * easeProgress;
        setDisplayValue(current);

        if (progress < 1) {
          requestAnimationFrame(tick);
        } else {
          setDisplayValue(endVal);
        }
      };

      requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !hasAnimated.current) {
            hasAnimated.current = true;
            runAnimation();
          }
        });
      },
      { threshold: 0.1 }
    );

    if (elementRef.current) {
      observer.observe(elementRef.current);
    }

    return () => observer.disconnect();
  }, [value, direction, delay, duration]);

  const formatted = Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  }).format(displayValue);

  return (
    <span
      ref={elementRef}
      className={cn("inline-block tabular-nums tracking-normal", className)}
    >
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
};
