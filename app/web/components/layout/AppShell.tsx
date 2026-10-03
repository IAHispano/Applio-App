"use client";

import { usePathname } from "next/navigation";
import { BottomNav } from "@/components/layout/MobileNav";
import PageTransition from "@/components/layout/PageTransition";
import Sidebar from "@/components/layout/Sidebar";
import SetupBarrier from "@/components/setup/SetupBarrier";
import { useSetup } from "@/lib/setup";

const UNGUARDED_ROUTES = new Set(["/", "/settings", "/report"]);

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isReady, loading } = useSetup();

  const isGuardedRoute = !UNGUARDED_ROUTES.has(pathname);
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
          <PageTransition>
            {showBarrier ? <SetupBarrier /> : children}
          </PageTransition>
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
