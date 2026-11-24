"use client";

import { memo } from "react";
import Button, { type ButtonProps } from "./Button";

export interface IconButtonProps extends Omit<ButtonProps, "children" | "icon"> {
  icon: React.ReactNode;
  label: string;
}

function IconButton({ icon, label, variant = "ghost", ...props }: IconButtonProps) {
  return <Button variant={variant} icon={icon} title={label} aria-label={label} {...props} />;
}

export default memo(IconButton);
