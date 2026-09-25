import type { Metadata, Viewport } from "next";
import { Syne } from "next/font/google";
import "@/app/globals.css";
import AppShell from "@/components/layout/AppShell";
import RoutePrewarm from "@/components/layout/RoutePrewarm";
import AutoUpdateModal from "@/components/setup/AutoUpdateModal";
import TermsModal from "@/components/setup/TermsModal";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import Toaster from "@/lib/toast";

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Applio",
  description: "A simple, high-quality voice conversion tool.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${syne.variable} bg-[var(--bg)] text-[var(--text)] overflow-hidden h-dvh w-screen flex flex-col m-0 p-0`}
      >
        <I18nProvider>
          <ThemeProvider>
            {/* Accessibility: Skip to Main Content Link for keyboard and screen reader navigation */}
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:bg-white focus:text-black focus:font-semibold focus:rounded-lg focus:shadow-xl focus:outline-2 focus:outline-white"
            >
              Skip to main content
            </a>
            <AppShell>{children}</AppShell>
            <TermsModal />
            <AutoUpdateModal />
            <Toaster />
            <RoutePrewarm />
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
