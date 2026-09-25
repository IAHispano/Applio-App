"use client";

import React from "react";
import { Button } from "@/components/ui";

interface CinematicSplashProps {
  title?: string;
  progress?: number;
  statusText?: string;
  error?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
}

export function CinematicSplash({
  title = "Applio",
  progress,
  error,
  onRetry,
  retryLabel = "Retry Connection",
}: CinematicSplashProps) {
  const [currentProgress, setCurrentProgress] = React.useState(progress ?? 0);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const [titleWidth, setTitleWidth] = React.useState<number | undefined>(undefined);

  React.useLayoutEffect(() => {
    const updateWidth = () => {
      if (titleRef.current) {
        setTitleWidth(titleRef.current.getBoundingClientRect().width);
      }
    };
    updateWidth();
    if (typeof document !== "undefined" && document.fonts) {
      document.fonts.ready.then(updateWidth);
    }
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  React.useEffect(() => {
    if (typeof progress === "number") {
      setCurrentProgress(progress);
      return;
    }

    const start = performance.now();
    let frameId: number;
    const update = (now: number) => {
      const elapsed = (now - start) / 1000;
      const nextVal = Math.min(95, 100 * (1 - Math.exp(-elapsed / 2)));
      setCurrentProgress(nextVal);
      frameId = requestAnimationFrame(update);
    };
    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [progress]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="h-full w-full min-h-[560px] flex items-center justify-center select-none p-4 sm:p-10"
    >
      <div
        className="relative w-full max-w-5xl sm:max-w-6xl aspect-[16/9] rounded-2xl overflow-hidden border border-white/10 shadow-2xl flex flex-col items-center justify-center"
        style={{
          backgroundColor: "#060606",
          backgroundImage:
            "radial-gradient(ellipse 55% 50% at 50% 50%, rgba(255, 255, 255, 0.25) 0%, rgba(255, 255, 255, 0.11) 28%, rgba(255, 255, 255, 0.03) 50%, rgba(6, 6, 6, 0) 72%)",
        }}
      >
        {/* Background Lines SVG - Inset, centered, with soft edge fade */}
        <svg
          aria-hidden="true"
          viewBox="0 0 1373 777"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="xMidYMid meet"
          className="absolute w-[82%] h-[80%] max-w-4xl max-h-[540px] pointer-events-none"
          style={{
            WebkitMaskImage:
              "radial-gradient(ellipse 75% 70% at 50% 50%, #000000 30%, rgba(0, 0, 0, 0.4) 60%, transparent 90%)",
            maskImage:
              "radial-gradient(ellipse 75% 70% at 50% 50%, #000000 30%, rgba(0, 0, 0, 0.4) 60%, transparent 90%)",
          }}
        >
          <g opacity="0.22" stroke="white" strokeWidth="1.5">
            <line x1="4.48657" y1="1" x2="1370.49" y2="1" />
            <line x1="4.48657" y1="80" x2="1370.49" y2="80" />
            <line x1="4.48657" y1="770" x2="1370.49" y2="770" />
            <line x1="4.48657" y1="700" x2="1370.49" y2="700" />
            <line x1="4.48657" y1="641" x2="1370.49" y2="641" />
            <line x1="157.487" y1="2" x2="157.487" y2="771" />
            <line x1="1209.49" y1="2" x2="1209.49" y2="771" />
            <path d="M198.987 1L298.487 84" />
            <path d="M189.987 637L3.48657 740.5M359.487 637L194.487 775M489.987 636L388.987 775M605.487 636L544.987 773.5" />
            <path d="M1170.49 635.5L1371.99 753M1008.99 635.5L1172.99 772.5M876.987 636.5L976.987 775M778.487 636L824.487 776" />
            <path d="M390.987 1.5L453.987 88.5M544.487 0.5L582.987 86.5M822.987 0.5L795.487 86.5M975.487 1.5L913.487 86.5M1174.49 1.5L1074.49 86M1371.99 20L1206.99 117" />
            <path d="M0.486572 29.5L167.487 122.5" />
          </g>
        </svg>

        {/* Center Content */}
        <div className="relative z-10 flex flex-col items-center justify-center -mt-2">
          <div className="inline-flex flex-col items-stretch w-max">
            {/* Subtle Glow Title in Syne */}
            <h1
              ref={titleRef}
              className="text-6xl sm:text-7xl md:text-8xl font-bold tracking-tight text-white m-0 whitespace-nowrap block"
              style={{
                fontFamily: "var(--font-sans), 'Syne', sans-serif",
                textShadow: "0 0 14px rgba(255, 255, 255, 0.25)",
              }}
            >
              {title}
            </h1>

            {/* Loader bar with no border, 10px height, matching title width, and subtle glow */}
            <div
              className="relative mt-7 sm:mt-8 w-full h-2.5 bg-white/[0.14] rounded-full overflow-hidden shadow-inner"
              style={{
                width: titleWidth ? `${titleWidth}px` : "100%",
                height: "10px",
              }}
            >
              <div
                className="h-full bg-white rounded-full transition-[width] duration-150 ease-out"
                style={{
                  width: `${Math.max(4, Math.min(100, currentProgress))}%`,
                  boxShadow: "0 0 8px rgba(255, 255, 255, 0.45)",
                }}
              />
            </div>
          </div>

          {/* Error and retry if present */}
          {error && (
            <div className="mt-5 flex flex-col items-center gap-2 px-4 text-center">
              <p className="text-xs text-red-400 max-w-sm">{error}</p>
              {onRetry && (
                <Button variant="ghost" size="xs" onClick={onRetry}>
                  {retryLabel}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CinematicSplash;
