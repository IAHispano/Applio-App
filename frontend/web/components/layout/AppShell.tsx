"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import HalloweenEffects from "@/components/HalloweenEffects";
import Link from "@/components/layout/IntentLink";
import { BottomNav } from "@/components/layout/MobileNav";
import { SETUP_OPTIONAL_ROUTES } from "@/components/layout/nav";
import PageTransition from "@/components/layout/PageTransition";
import PersistentWorkspace from "@/components/layout/PersistentWorkspace";
import Sidebar from "@/components/layout/Sidebar";
import RealtimeGpuBanner from "@/components/RealtimeGpuBanner";
import RemoteBridgeBanner from "@/components/RemoteBridgeBanner";
import SupportLink from "@/components/SupportLink";
import SetupBarrier from "@/components/setup/SetupBarrier";
import { REMOTE_HOST_ROUTES, useRemoteBridge } from "@/lib/bridge-mode";
import { useI18n } from "@/lib/i18n";
import { normalizeJobHref } from "@/lib/job-url";
import { useSetup } from "@/lib/setup";
import { workspaceScroll } from "@/lib/workspace-state";

const RealtimeWorkspace = dynamic(() => import("@/components/RealtimeWorkspace"), { ssr: false });

export default function AppShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const visibility = () => {
      document.documentElement.toggleAttribute("data-app-hidden", document.hidden);
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      document.documentElement.removeAttribute("data-app-hidden");
    };
  }, []);
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const { remote } = useRemoteBridge();
  const previousPath = useRef(pathname);
  const previousHeading = useRef<HTMLElement | null>(null);
  const scrollRoute = useRef({ path: pathname, top: 0, restoring: false });
  if (scrollRoute.current.path !== pathname) {
    scrollRoute.current = { path: pathname, top: workspaceScroll.get(pathname) ?? 0, restoring: true };
  }
  useEffect(() => {
    if (previousPath.current === pathname) {
      previousHeading.current = document.querySelector("#main-content h1");
      return;
    }
    previousPath.current = pathname;
    // Next can update the URL before the new page replaces the old heading.
    let restoreFrame = 0;
    const focusPage = () => {
      if (document.querySelector("dialog[open]")) return;
      const main = document.getElementById("main-content");
      if (!main) return;
      const heading = main.querySelector<HTMLElement>("h1");
      if (!heading || heading === previousHeading.current) return;
      previousHeading.current = heading;
      main.scrollTop = scrollRoute.current.top;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      // Next's own navigation focus can run after the route commits. Restore
      // once layout settles and ignore its automatic scroll events meanwhile.
      restoreFrame = requestAnimationFrame(() => {
        main.scrollTop = scrollRoute.current.top;
        scrollRoute.current.restoring = false;
      });
      observer.disconnect();
    };
    const observer = new MutationObserver(focusPage);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    const frame = requestAnimationFrame(focusPage);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(restoreFrame);
      observer.disconnect();
    };
  }, [pathname]);
  useEffect(() => {
    const bridge = (
      window as unknown as { applio?: { onNavigate?: (listener: (href: string) => void) => () => void } }
    ).applio;
    return bridge?.onNavigate?.((href) => {
      if (href.startsWith("/") && !href.startsWith("//")) router.push(normalizeJobHref(href));
    });
  }, [router]);
  const { isReady, loading } = useSetup();

  const isGuardedRoute = !SETUP_OPTIONAL_ROUTES.has(pathname) && !pathname.startsWith("/jobs/");
  const showBarrier = !isReady && !loading && isGuardedRoute;

  const hostOnly = remote && REMOTE_HOST_ROUTES.has(pathname);
  const hidePage = pathname === "/realtime" && isReady && !remote;

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden relative">
      <Sidebar />
      <HalloweenEffects />
      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        <RemoteBridgeBanner />
        {pathname !== "/realtime" && <RealtimeGpuBanner />}
        <main
          id="main-content"
          onScroll={(event) => {
            if (!scrollRoute.current.restoring) workspaceScroll.set(pathname, event.currentTarget.scrollTop);
          }}
          tabIndex={-1}
          className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-clip px-3 sm:px-5 lg:px-6 2xl:px-8 pt-4 pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-4 outline-none flex flex-col"
        >
          <div
            hidden={hidePage}
            className={hidePage ? undefined : "flex min-h-full w-full min-w-0 flex-[1_0_auto] flex-col"}
          >
            <PageTransition>
              {hostOnly || (remote && showBarrier) ? (
                <div className="card space-y-3">
                  <h1 className="text-xl font-semibold m-0">{t("Available on your host computer")}</h1>
                  <p className="field-help m-0">
                    {t(
                      "Use Bridge Mode for inference, TTS, audio separation, audio tools, and job history. Manage models, setup, settings, and realtime on your host.",
                    )}
                  </p>
                  <Link href="/inference" className="text-sm underline">
                    {t("Convert Audio")}
                  </Link>
                </div>
              ) : showBarrier ? (
                <SetupBarrier />
              ) : pathname === "/realtime" && loading ? (
                <p className="text-xs text-neutral-400">{t("Loading…")}</p>
              ) : (
                children
              )}
            </PageTransition>
          </div>
          {!remote && (
            <PersistentWorkspace active={pathname === "/realtime" && isReady}>
              <RealtimeWorkspace active={pathname === "/realtime"} />
            </PersistentWorkspace>
          )}
          <footer className="mt-auto pt-6 pb-1 flex items-center justify-center gap-3 text-[11px] text-[var(--muted)]">
            <span>Applio</span>
            <span aria-hidden="true">·</span>
            <SupportLink />
          </footer>
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
