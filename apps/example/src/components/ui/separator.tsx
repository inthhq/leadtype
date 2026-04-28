import { Root as SeparatorRoot } from "@radix-ui/react-separator";
import type * as React from "react";
import { cn } from "@/lib/utils";

export function Separator({
  className,
  decorative = true,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof SeparatorRoot>) {
  return (
    <SeparatorRoot
      className={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px",
        className
      )}
      decorative={decorative}
      orientation={orientation}
      {...props}
    />
  );
}
