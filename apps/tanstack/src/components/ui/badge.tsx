import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 font-semibold text-[0.7rem] uppercase tracking-[0.16em]",
  {
    variants: {
      variant: {
        default: "border-primary/20 bg-primary/10 text-primary",
        secondary: "border-secondary/80 bg-secondary text-secondary-foreground",
        outline: "border-border bg-background/70 text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ className, variant }))} {...props} />
  );
}
