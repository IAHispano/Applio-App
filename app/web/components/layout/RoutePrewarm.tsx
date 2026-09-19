"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { MENU } from "./nav";

export default function RoutePrewarm() {
  const router = useRouter();

  useEffect(() => {
    // Warm primary routes immediately so clicks are instantaneous
    const primary = ["/inference", "/tts", "/models", "/settings", "/extra", "/train"];
    for (const route of primary) {
      try {
        router.prefetch(route);
      } catch {
        /* ignore */
      }
    }

    // Warm remaining routes right after
    const remaining = MENU.map((e) => e.to).filter((to) => !primary.includes(to));
    const timer = setTimeout(() => {
      for (const route of remaining) {
        try {
          router.prefetch(route);
        } catch {
          /* ignore */
        }
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [router]);

  return null;
}
