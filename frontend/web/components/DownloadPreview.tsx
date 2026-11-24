"use client";

import Button from "@/components/ui/Button";
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
      {url &&
        (blob.type.startsWith("audio/") ? (
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
        ))}
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>
          {t("Close")}
        </Button>
        {url && (
          <Button href={url} download={filename}>
            {t("Save File")}
          </Button>
        )}
      </div>
    </Modal>
  );
}
