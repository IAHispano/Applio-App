"use client";

import Link from "next/link";
import { type ComponentProps, useState } from "react";

// Keep unused screens out of startup; warm a link when the user approaches it.
export default function IntentLink({
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...props
}: Omit<ComponentProps<typeof Link>, "prefetch">) {
  const [prefetch, setPrefetch] = useState(false);
  return (
    <Link
      {...props}
      prefetch={prefetch ? null : false}
      onMouseEnter={(event) => {
        setPrefetch(true);
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        setPrefetch(true);
        onFocus?.(event);
      }}
      onTouchStart={(event) => {
        setPrefetch(true);
        onTouchStart?.(event);
      }}
    />
  );
}
