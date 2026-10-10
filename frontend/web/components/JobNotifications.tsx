"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { apiGet } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { type JobActivity, JobNotificationTracker } from "@/lib/job-notifications";
import { disableSupportReminders, SUPPORT_URL, supportReminderDue } from "@/lib/support";
import { toast } from "@/lib/toast";

interface DesktopNotifications {
  showJobNotification?: (value: {
    id: string;
    title: string;
    body: string;
    href: string;
  }) => Promise<boolean>;
  onJobOpen?: (listener: (href: string) => void) => () => void;
}

export default function JobNotifications() {
  const { t } = useI18n();
  const router = useRouter();
  const tracker = useRef(new JobNotificationTracker());
  useEffect(() => {
    let disposed = false;
    let stream: EventSource | undefined;
    let polling: ReturnType<typeof setTimeout> | undefined;
    let supportTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const bridge = (window as unknown as { applio?: DesktopNotifications }).applio;
    const unsubscribe = bridge?.onJobOpen?.((href) => router.push(href));
    const announce = ({ job, terminal }: { job: JobActivity; terminal: boolean }) => {
      const href = `/jobs/${encodeURIComponent(job.id)}`;
      const title = t(job.label);
      const body = job.stopped
        ? t("Stopped.")
        : job.status === "error"
          ? t("Failed. Open the job for details.")
          : terminal
            ? t("Completed successfully.")
            : t("Started. You can keep using Applio.");
      toast(body, job.stopped ? "info" : job.status === "error" ? "error" : terminal ? "success" : "info", {
        id: `job-${job.id}`,
        title,
        duration: terminal ? 8000 : 3500,
        action: { label: t("View job"), href },
      });
      if (terminal) {
        try {
          if (bridge?.showJobNotification)
            void bridge.showJobNotification({ id: job.id, title, body, href }).catch(() => {});
          else if ("Notification" in window && Notification.permission === "granted") {
            const notification = new Notification(title, { body, tag: `job-${job.id}` });
            notification.onclick = () => {
              window.focus();
              router.push(href);
              notification.close();
            };
          }
        } catch {
          /* OS notification availability must not interrupt job feedback */
        }
        let remind = false;
        try {
          remind = job.status === "done" && !supportTimer && supportReminderDue(localStorage);
        } catch {
          /* storage may be disabled */
        }
        if (remind) {
          supportTimer = setTimeout(() => {
            if (disposed) return;
            toast(t("Enjoying Applio? Your support helps us keep it free."), "info", {
              id: "support-reminder",
              duration: 9000,
              action: { label: t("Support us"), href: SUPPORT_URL },
              secondaryAction: { label: t("Don't remind me"), onClick: disableSupportReminders },
            });
          }, 12000);
        }
      }
    };
    const snapshot = (jobs: JobActivity[]) => {
      for (const event of tracker.current.snapshot(jobs)) announce(event);
    };
    const poll = async () => {
      try {
        const data = await apiGet<{ jobs: JobActivity[] }>("/api/jobs/activity", {
          signal: controller.signal,
        });
        if (!disposed) snapshot(data.jobs);
      } catch {
        /* retry without spamming connection errors */
      }
      if (!disposed && (!stream || stream.readyState !== EventSource.OPEN)) polling = setTimeout(poll, 2000);
    };
    if (typeof EventSource !== "undefined") {
      stream = new EventSource("/api/jobs/events");
      stream.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as { jobs?: JobActivity[]; job?: JobActivity };
          if (data.jobs) snapshot(data.jobs);
          else if (data.job) for (const update of tracker.current.update(data.job)) announce(update);
        } catch {
          /* ignore malformed stream messages */
        }
      };
      stream.onopen = () => {
        clearTimeout(polling);
        polling = undefined;
      };
      stream.onerror = () => {
        if (!polling) polling = setTimeout(poll, 2000);
      };
    } else void poll();
    return () => {
      disposed = true;
      controller.abort();
      stream?.close();
      clearTimeout(polling);
      clearTimeout(supportTimer);
      unsubscribe?.();
    };
  }, [t, router]);
  return null;
}
