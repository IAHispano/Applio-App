"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { BottomNav } from "@/components/layout/MobileNav";
import PageTransition from "@/components/layout/PageTransition";
import PersistentWorkspace from "@/components/layout/PersistentWorkspace";
import Sidebar from "@/components/layout/Sidebar";
import RemoteBridgeBanner from "@/components/RemoteBridgeBanner";
import SupportLink from "@/components/SupportLink";
import SetupBarrier from "@/components/setup/SetupBarrier";
import { REMOTE_HOST_ROUTES, useRemoteBridge } from "@/lib/bridge-mode";
import { useI18n } from "@/lib/i18n";
import { useSetup } from "@/lib/setup";

const RealtimeWorkspace = dynamic(() => import("@/components/RealtimeWorkspace"), { ssr: false });

const UNGUARDED_ROUTES = new Set(["/", "/settings", "/report"]);

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const { remote } = useRemoteBridge();
  useEffect(() => {
    const bridge = (
      window as unknown as { applio?: { onNavigate?: (listener: (href: string) => void) => () => void } }
    ).applio;
    return bridge?.onNavigate?.((href) => {
      if (href.startsWith("/") && !href.startsWith("//")) router.push(href);
    });
  }, [router]);
  const { isReady, loading } = useSetup();

  const isGuardedRoute = !UNGUARDED_ROUTES.has(pathname) && !pathname.startsWith("/jobs/");
  const showBarrier = !isReady && !loading && isGuardedRoute;

  const hostOnly = remote && REMOTE_HOST_ROUTES.has(pathname);
  const hidePage = pathname === "/realtime" && isReady && !remote;

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden relative">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        <RemoteBridgeBanner />
        <main
          id="main-content"
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
                  <a href="/inference" className="text-sm underline">
                    {t("Go to Inference")}
                  </a>
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
              <RealtimeWorkspace />
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
