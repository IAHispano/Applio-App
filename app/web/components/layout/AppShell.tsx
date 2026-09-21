import { BottomNav } from "@/components/layout/MobileNav";
import PageTransition from "@/components/layout/PageTransition";
import Sidebar from "@/components/layout/Sidebar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 min-h-0 overflow-hidden relative">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-clip px-3 sm:px-5 lg:px-6 2xl:px-8 pt-4 pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-4 outline-none flex flex-col"
        >
          <PageTransition>{children}</PageTransition>
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
