"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Distilled: /convert duplicated /inference (Single/Batch) + /tts.
// Gradio original has Inference (Single/Batch) as ONE tab — keep that
// as authority and preserve old links via redirect.
export default function ConvertPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/inference");
  }, [router]);

  return null;
}
