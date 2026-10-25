"use client";
import { SquarePlay } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import type { useYoutubeAudio } from "./useYoutubeAudio";

export default function YoutubeSource({
  source,
  idSuffix,
  disabled,
}: {
  source: ReturnType<typeof useYoutubeAudio>;
  idSuffix: string;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2 py-1">
      <label htmlFor={`yt-url-${idSuffix}`} className="text-xs font-medium text-neutral-300">
        {t("Paste a YouTube link")}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`yt-url-${idSuffix}`}
          type="url"
          value={source.url}
          disabled={disabled || source.active}
          onChange={(e) => source.setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") source.start();
          }}
          placeholder="https://youtube.com/watch?v=…"
          className="flex-1 min-w-0"
        />
        <Button
          size="sm"
          onClick={source.start}
          disabled={disabled || source.active || !source.url.trim()}
          loading={source.active}
          icon={<SquarePlay size={14} />}
        >
          {t("Fetch audio")}
        </Button>
      </div>
      <p className="text-[11px] text-neutral-500 m-0">
        {source.active
          ? t("Downloading… the track is saved to assets/audios when done.")
          : t("Single videos only — saved to assets/audios for reuse.")}
      </p>
      {source.error && <Alert variant="error">{source.error}</Alert>}
    </div>
  );
}
