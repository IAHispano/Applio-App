"use client";

import { Compass } from "lucide-react";
import { Button, Card, EmptyState } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <Card className="w-full max-w-2xl mx-auto my-auto">
      <EmptyState
        headingLevel={1}
        icon={<Compass size={24} aria-hidden="true" />}
        title={t("Page Not Found")}
        description={t("The requested page could not be found.")}
        action={<Button href="/">{t("Return Home")}</Button>}
      />
    </Card>
  );
}
