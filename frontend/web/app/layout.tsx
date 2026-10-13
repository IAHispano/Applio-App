import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "@/app/globals.css";
import JobNotifications from "@/components/JobNotifications";
import AppShell from "@/components/layout/AppShell";
import SkipLink from "@/components/layout/SkipLink";
import AutoUpdateModal from "@/components/setup/AutoUpdateModal";
import TermsModal from "@/components/setup/TermsModal";
import { RemoteBridgeProvider } from "@/lib/bridge-mode";
import { I18nProvider } from "@/lib/i18n";
import { SetupProvider } from "@/lib/setup";
import { ThemeProvider } from "@/lib/theme";
import Toaster from "@/lib/toast";

const syne = localFont({
  src: "../../../assets/fonts/Syne-Variable.ttf",
  variable: "--font-syne",
  weight: "400 800",
  style: "normal",
  display: "swap",
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
    <html lang="en" className={syne.variable}>
      <body className="bg-[var(--bg)] text-[var(--text)] overflow-hidden h-dvh w-screen flex flex-col m-0 p-0">
        <I18nProvider>
          <RemoteBridgeProvider>
            <ThemeProvider>
              <SetupProvider>
                <SkipLink />
                <AppShell>{children}</AppShell>
                <TermsModal />
                <AutoUpdateModal />
                <Toaster />
                <JobNotifications />
              </SetupProvider>
            </ThemeProvider>
          </RemoteBridgeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
