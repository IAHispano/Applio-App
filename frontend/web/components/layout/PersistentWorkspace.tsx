"use client";

import { type ReactNode, useEffect, useState } from "react";

// Mount on first use, then hide instead of unmounting during navigation.
export default function PersistentWorkspace({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(active);
  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);
  return (
    <div hidden={!active} className="w-full">
      {active || visited ? children : null}
    </div>
  );
}
