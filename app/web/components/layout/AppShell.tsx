"use client";

import { usePathname } from "next/navigation";
import { BottomNav } from "@/components/layout/MobileNav";
import PageTransition from "@/components/layout/PageTransition";
import Sidebar from "@/components/layout/Sidebar";
import SupportLink from "@/components/SupportLink";
import SetupBarrier from "@/components/setup/SetupBarrier";
import { useSetup } from "@/lib/setup";

const UNGUARDED_ROUTES = new Set(["/", "/settings", "/report"]);

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isReady, loading } = useSetup();

  const isGuardedRoute = !UNGUARDED_ROUTES.has(pathname) && !pathname.startsWith("/jobs/");
  const showBarrier = !isReady && !loading && isGuardedRoute;

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden relative">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-clip px-3 sm:px-5 lg:px-6 2xl:px-8 pt-4 pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-4 outline-none flex flex-col"
        >
          <PageTransition>{showBarrier ? <SetupBarrier /> : children}</PageTransition>
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
