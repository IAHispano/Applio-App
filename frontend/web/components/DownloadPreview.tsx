"use client";

import Modal from "@/components/ui/Modal";
import { useI18n } from "@/lib/i18n";
import { usePreviewUrl } from "@/lib/usePreviewUrl";

export default function DownloadPreview({
  blob,
  filename,
  onClose,
}: {
  blob: Blob;
  filename: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const url = usePreviewUrl(blob);
  return (
    <Modal isOpen onClose={onClose} title={filename} size="xl">
      {url && (
        <>
          {blob.type.startsWith("audio/") ? (
            // Generated audio has no speech transcript.
            // biome-ignore lint/a11y/useMediaCaption: This is a preview of the user's audio file.
            <audio src={url} controls className="w-full" />
          ) : (
            <iframe
              title={filename}
              src={url}
              sandbox=""
              className="w-full h-[60vh] rounded-lg border-0 bg-white"
            />
          )}
          <a href={url} download={filename} className="inline-flex ghost rounded-lg px-4 py-2 text-sm">
            {t("Save File")}
          </a>
        </>
      )}
      <button type="button" onClick={onClose} className="ghost rounded-lg px-4 py-2 text-sm">
        {t("Close")}
      </button>
    </Modal>
  );
}
