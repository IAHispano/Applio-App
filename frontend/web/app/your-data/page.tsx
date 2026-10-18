"use client";

import { BookOpen, ExternalLink, ShieldCheck } from "lucide-react";
import Link from "@/components/layout/IntentLink";
import PageHeader from "@/components/layout/PageHeader";
import { Button, Card, CardHeader } from "@/components/ui";
import { DOCS_URL, WEBSITE_URL } from "@/lib/ecosystem";
import { useI18n } from "@/lib/i18n";

const TOPICS = [
  {
    title: "Your voice and your rights",
    text: "Applio does not claim ownership of your recordings, datasets, trained models, or outputs. Using the app does not give the project permission to sell, publish, or train on your private material.",
  },
  {
    title: "Commercial Use",
    text: "Commercial use is permitted when you have the necessary rights. Check voice permissions and the licenses of recordings, models, datasets, and speech providers. An output alone does not guarantee exclusive copyright.",
  },
  {
    title: "Processing on your computer",
    text: "Conversion, training, realtime, blending, and separation run on the engine host. Required resources may need downloading first. If you use a remote or cloud host, your files are processed there, under that operator's control.",
  },
  {
    title: "Text to Speech",
    text: "Edge TTS sends your text and voice settings to Microsoft for synthesis. Returned audio is converted locally; this request does not upload your RVC model. Avoid TTS, including API speech requests, to avoid sending text to Microsoft.",
  },
  {
    title: "Other online connections",
    text: "Downloads and update checks contact their hosting services. Google fonts contact Google; Discord presence shares activity with Discord. These requests do not upload voice files. Providers receive connection metadata and apply their own retention rules.",
  },
  {
    title: "Sharing and connected apps",
    text: "Bridge traffic, including audio and results, passes through Cloudflare. Authorized API apps can run operations and retrieve results. Stop Bridge, revoke devices or API access, and review diagnostics before opening a GitHub report or attaching recordings.",
  },
  {
    title: "Storage and deletion",
    text: "Inputs, copies, datasets, models, outputs, caches, and logs can remain on the engine host. Check storage in Settings. Stop jobs before deleting files; uninstalling or clearing history does not erase every copy, backup, or shared file.",
  },
  {
    title: "A local workflow",
    text: "Download required resources first, then use local audio instead of online TTS. Leave Bridge stopped, protect API keys, disable Discord presence, and use the bundled font. Avoid cloud-synced folders. Disconnect the network for a strictly offline session.",
  },
  {
    title: "Terms and other versions",
    text: "The MIT license covers software, not ownership of your content. The Terms of Use still apply, including amendments. This guide describes the current desktop app; older versions, Gradio, plugins, and hosted services can differ. Gradio has separate analytics settings.",
  },
] as const;

export default function YourDataPage() {
  const { t } = useI18n();
  return (
    <div className="page-stack max-w-6xl mx-auto w-full">
      <PageHeader
        title={t("Your data & privacy")}
        description={t("Understand your rights, local processing, and optional online features.")}
        guide={false}
      >
        <Button
          href={new URL("terms-use/", WEBSITE_URL).href}
          target="_blank"
          variant="ghost"
          size="sm"
          icon={<ExternalLink size={14} />}
        >
          {t("Terms of Use")}
        </Button>
        <Button href={DOCS_URL} target="_blank" variant="ghost" size="sm" icon={<BookOpen size={14} />}>
          {t("Documentation")}
        </Button>
      </PageHeader>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {TOPICS.map((topic, index) => (
          <Card
            key={topic.title}
            as="section"
            className={index === 0 ? "md:col-span-2 border-[var(--accent)]" : ""}
          >
            <CardHeader icon={index === 0 ? <ShieldCheck size={20} /> : undefined} title={t(topic.title)} />
            <p className="text-sm leading-relaxed text-[var(--muted)] m-0">{t(topic.text)}</p>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button href="/settings" variant="ghost">
          {t("Settings")}
        </Button>
        <Link href="/" className="text-sm underline underline-offset-4 text-[var(--muted)]">
          {t("Home")}
        </Link>
      </div>
    </div>
  );
}
