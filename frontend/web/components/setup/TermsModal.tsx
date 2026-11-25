"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button, Dialog } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

const TERMS_STORAGE_KEY = "applio:terms-accepted";
const TERMS_DATE_KEY = "applio:terms-accepted-at";
const TERMS_ACCEPTED_EVENT = "applio:terms-accepted";

export function hasAcceptedTerms(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(TERMS_STORAGE_KEY) === "true";
  } catch {
    return true;
  }
}

export function useAcceptedTerms(): boolean {
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    const update = () => setAccepted(hasAcceptedTerms());
    update();
    window.addEventListener(TERMS_ACCEPTED_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(TERMS_ACCEPTED_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return accepted;
}

export default function TermsModal({ privacyGuide }: { privacyGuide?: ReactNode }) {
  const pathname = usePathname();
  const { t, loaded } = useI18n();
  const [open, setOpen] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // The privacy guide remains available without accepting the terms.
    setOpen(pathname !== "/your-data" && !hasAcceptedTerms() && loaded);
  }, [loaded, pathname]);

  const handleAccept = () => {
    try {
      localStorage.setItem(TERMS_STORAGE_KEY, "true");
      localStorage.setItem(TERMS_DATE_KEY, new Date().toISOString());
    } catch {
      /* non-fatal */
    }
    setOpen(false);
    window.dispatchEvent(new Event(TERMS_ACCEPTED_EVENT));
  };

  if (!open || pathname === "/your-data") return null;

  return (
    <Dialog
      isOpen={open}
      initialFocus={titleRef}
      aria-labelledby="terms-modal-title"
      aria-describedby="terms-modal-description"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-xl">
        <div className="min-h-0 overflow-y-auto px-5 py-6 sm:px-8 sm:py-8">
          <h2
            id="terms-modal-title"
            ref={titleRef}
            tabIndex={-1}
            className="m-0 text-2xl font-semibold text-[var(--heading)] tracking-tight"
          >
            {t("Welcome to Applio")}
          </h2>
          <p id="terms-modal-description" className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
            {t("Before you get started, here are a few basics for using Applio responsibly.")}
          </p>

          <ul className="my-5 list-disc space-y-2 ps-5 text-sm leading-relaxed text-[var(--text)]">
            <li>{t("Use audio you own or have permission to use.")}</li>
            <li>{t("Respect people’s privacy and avoid misleading or harming others.")}</li>
            <li>{t("Follow the laws where you live.")}</li>
          </ul>

          <details className="border-t border-[var(--border)]">
            <summary className="cursor-pointer py-3 text-sm font-medium text-[var(--heading)]">
              {t("Terms of Use")}
            </summary>
            <div className="space-y-5 pb-2 text-sm leading-relaxed text-[var(--text)]">
              <section className="space-y-2">
                <h3 className="font-semibold text-[var(--heading)]">{t("Responsibilities of the User")}</h3>
                <p>{t("By using Applio, you agree to the following responsibilities:")}</p>
                <ul className="list-none space-y-3 p-0">
                  <li>
                    <strong>{t("Respect Intellectual Property and Privacy Rights")}</strong>
                    <ul className="mt-1 list-disc space-y-1 ps-5">
                      <li>
                        {t(
                          "Ensure that any audio or material processed through Applio is either owned by you or used with explicit permission from the rightful owner.",
                        )}
                      </li>
                      <li>
                        {t(
                          "Respect copyrights, intellectual property rights, and privacy rights of all individuals and entities.",
                        )}
                      </li>
                    </ul>
                  </li>
                  <li>
                    <strong>{t("Avoid Harmful or Unethical Use")}</strong>
                    <ul className="mt-1 list-disc space-y-1 ps-5">
                      <li>
                        {t(
                          "Do not use Applio to create or distribute content that harms, defames, or infringes upon the rights of others.",
                        )}
                      </li>
                      <li>
                        {t(
                          "Avoid any activities that may violate ethical standards, promote hate speech, or facilitate illegal conduct.",
                        )}
                      </li>
                    </ul>
                  </li>
                  <li>
                    <strong>{t("Adhere to Local Laws and Regulations")}</strong>
                    <p>
                      {t(
                        "Familiarize yourself with and comply with the laws and regulations governing the use of AI, voice transformation tools, and generated content in your jurisdiction.",
                      )}
                    </p>
                  </li>
                </ul>
              </section>
              <section className="space-y-2">
                <h3 className="font-semibold text-[var(--heading)]">{t("Disclaimer of Liability")}</h3>
                <p>
                  {t(
                    "Applio and its contributors disclaim all liability for any misuse or unintended consequences arising from the use of this tool.",
                  )}
                </p>
                <ul className="list-none space-y-3 p-0">
                  <li>
                    <strong>{t("No Warranty")}</strong>
                    <p>{t('Applio is provided "as is" without any warranty, express or implied.')}</p>
                  </li>
                  <li>
                    <strong>{t("User Responsibility")}</strong>
                    <p>
                      {t(
                        "You bear full responsibility for how you choose to use Applio and any outcomes resulting from that use.",
                      )}
                    </p>
                  </li>
                  <li>
                    <strong>{t("No Endorsement")}</strong>
                    <p>
                      {t(
                        "Applio does not endorse or support any activities or content created with this tool that result in harm, illegal activity, or unethical practices.",
                      )}
                    </p>
                  </li>
                </ul>
              </section>
              <section className="space-y-2">
                <h3 className="font-semibold text-[var(--heading)]">{t("Permitted Use Cases")}</h3>
                <p>{t("Applio is designed for:")}</p>
                <ul className="list-none space-y-3 p-0">
                  <li>
                    <strong>{t("Personal Projects")}</strong>
                    <p>{t("Experimentation and creative endeavors for personal enrichment.")}</p>
                  </li>
                  <li>
                    <strong>{t("Academic Research")}</strong>
                    <p>{t("Advancing scientific understanding and education.")}</p>
                  </li>
                  <li>
                    <strong>{t("Investigative Purposes")}</strong>
                    <p>{t("Analyzing data in lawful and ethical contexts.")}</p>
                  </li>
                  <li>
                    <strong>{t("Commercial Use")}</strong>
                    <p>
                      {t(
                        "Creating content for commercial purposes, provided that appropriate rights and permissions are obtained and all legal and ethical standards are adhered to.",
                      )}
                    </p>
                  </li>
                </ul>
              </section>
              <section className="space-y-2">
                <h3 className="font-semibold text-[var(--heading)]">{t("Prohibited Activities")}</h3>
                <p>{t("The following uses are explicitly prohibited:")}</p>
                <ul className="list-none space-y-3 p-0">
                  <li>
                    <strong>{t("Harmful Applications")}</strong>
                    <p>{t("Generating audio to defame, harm, or manipulate others.")}</p>
                  </li>
                  <li>
                    <strong>{t("Unauthorized Distribution")}</strong>
                    <p>{t("Sharing content that violates copyrights or the rights of others.")}</p>
                  </li>
                  <li>
                    <strong>{t("Deceptive Practices")}</strong>
                    <p>{t("Creating content intended to deceive or defraud others.")}</p>
                  </li>
                </ul>
              </section>
              <section className="space-y-2">
                <h3 className="font-semibold text-[var(--heading)]">{t("Training Data")}</h3>
                <p>
                  {t(
                    "All official models distributed by Applio have been trained under publicly available datasets such as",
                  )}{" "}
                  <a
                    href="https://huggingface.co/datasets/IAHispano/Applio-Dataset"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4"
                  >
                    VCTK
                  </a>
                  .{" "}
                  {t(
                    "We strive to maintain transparency and ethical practices in the development and distribution of our tools.",
                  )}
                </p>
              </section>
              <section className="space-y-2">
                <h3 className="font-semibold text-[var(--heading)]">{t("Amendments")}</h3>
                <p>
                  {t(
                    "Applio reserves the right to modify these terms at any time. Continued use of the tool signifies your acceptance of any updated terms.",
                  )}
                </p>
              </section>
            </div>
          </details>

          {privacyGuide && (
            <details className="border-t border-[var(--border)]">
              <summary className="cursor-pointer py-3 text-sm font-medium text-[var(--heading)]">
                {t("Your data & privacy")}
              </summary>
              {privacyGuide}
            </details>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-[var(--border)] px-5 py-4 sm:px-8">
          <Button onClick={handleAccept}>{t("Accept & Continue")}</Button>
        </div>
      </div>
    </Dialog>
  );
}
