import { type Job, setJobStage, setProgress } from "@/jobs";

/** Engine markers are handled in order, including multiple lines in one chunk. */
export function trackConversionStage(job: Job, output: string) {
  for (const line of output.split(/[\r\n]+/)) {
    if (line.includes("[applio-stage:synthesizing]")) setJobStage(job, "Generating speech…");
    else if (/TTS audio generated/i.test(line)) setJobStage(job, "Loading voice model…");
    else if (/Converting audio '/i.test(line)) setJobStage(job, "Converting audio…");
    const split = line.match(/Audio split into (\d+) chunks/);
    if (split && Number(split[1]) > 0) {
      setJobStage(job, "Converting audio…", 0, Number(split[1]));
      setProgress(job, 0);
    }
    const converted = line.match(/Converted audio chunk (\d+)/);
    if (converted && job.stageTotal && job.stage === "Converting audio…") {
      const current = Math.min(Number(converted[1]), job.stageTotal);
      setJobStage(job, "Converting audio…", current, job.stageTotal);
      setProgress(job, (current * 100) / job.stageTotal);
    }
    if (/Saving audio as/i.test(line)) setJobStage(job, "Saving audio…");
  }
}
