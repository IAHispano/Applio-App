import { Suspense } from "react";
import JobPage from "@/components/JobPage";

export default function JobView() {
  return (
    <Suspense>
      <JobPage />
    </Suspense>
  );
}
