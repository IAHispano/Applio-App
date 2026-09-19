"use client";

import { useEffect, useMemo, useState } from "react";

// Object-URL helper with automatic revoke.
export function usePreviewUrl(file: File | Blob | null, fallbackPath?: string): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return useMemo(() => {
    if (objectUrl) return objectUrl;
    if (fallbackPath) return `/${fallbackPath.replace(/^[\\/]+/, "").replace(/\\/g, "/")}`;
    return null;
  }, [objectUrl, fallbackPath]);
}
