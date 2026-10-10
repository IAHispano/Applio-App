"use client";

import { useRouter } from "next/navigation";
import FirstRunSetup from "@/components/setup/FirstRunSetup";

export default function SetupPage() {
  const router = useRouter();
  return <FirstRunSetup onComplete={() => router.push("/")} />;
}
