import type { Metadata, Viewport } from "next";
import { Syne } from "next/font/google";
import "@/app/globals.css";
import AppShell from "@/components/layout/AppShell";
import SkipLink from "@/components/layout/SkipLink";
import AutoUpdateModal from "@/components/setup/AutoUpdateModal";
import TermsModal from "@/components/setup/TermsModal";
import { I18nProvider } from "@/lib/i18n";
import { SetupProvider } from "@/lib/setup";
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
            <SetupProvider>
              <SkipLink />
              <AppShell>{children}</AppShell>
              <TermsModal />
              <AutoUpdateModal />
              <Toaster />
            </SetupProvider>
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
