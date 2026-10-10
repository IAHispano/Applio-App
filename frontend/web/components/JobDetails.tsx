"use client";

import type { Job } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { fieldLabel, fieldValue } from "@/lib/job-history";

export default function JobDetails({ job }: { job: Job }) {
  const { t } = useI18n();
  const sections = [
    ["Settings", job.params],
    ["Results", job.result],
  ] as const;
  return (
    <div className="space-y-5 text-xs">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          ["Job ID", job.id],
          ["Created", job.createdAt],
          ["Started", job.startedAt],
          ["Finished", job.finishedAt],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[var(--muted)] mb-1">{t(label || "")}</dt>
            <dd className="m-0 break-all">
              {value ? (label === "Job ID" ? value : new Date(value).toLocaleString()) : "—"}
            </dd>
          </div>
        ))}
      </dl>
      {sections.map(
        ([title, data]) =>
          data &&
          Object.keys(data).length > 0 && (
            <section key={title}>
              <h3 className="text-sm font-medium mt-0 mb-3">{t(title)}</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                {Object.entries(data)
                  .filter(([, value]) => value !== undefined && value !== null && value !== "")
                  .map(([key, value]) => (
                    <div key={key} className="min-w-0">
                      <dt className="text-[var(--muted)] mb-1">{t(fieldLabel(key))}</dt>
                      <dd className="m-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                        {typeof value === "boolean" ? t(fieldValue(value)) : fieldValue(value)}
                      </dd>
                    </div>
                  ))}
              </dl>
            </section>
          ),
      )}
      {job.errorDetails && (
        <section>
          <h3 className="text-sm font-medium mt-0 mb-2">{t("Failure details")}</h3>
          <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs p-3 rounded-lg bg-black/30">
            {job.errorDetails}
          </pre>
        </section>
      )}
    </div>
  );
}
