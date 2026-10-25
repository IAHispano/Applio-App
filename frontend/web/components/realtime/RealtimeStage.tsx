"use client";

import type { ReactNode } from "react";
import { Card, CardHeader } from "@/components/ui";

export default function Stage({
  step,
  title,
  description,
  icon,
  children,
  disabled = false,
}: {
  step: number;
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Card as="section" aria-label={`${step}. ${title}`}>
      <CardHeader step={step} title={title} description={description} icon={icon} />
      <fieldset disabled={disabled} className="min-w-0 border-0 m-0 p-0">
        {children}
      </fieldset>
    </Card>
  );
}
