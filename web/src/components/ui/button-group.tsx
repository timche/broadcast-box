import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Groups adjacent buttons into a single connected control (shadcn button-group). */
function ButtonGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="button-group"
      role="group"
      className={cn(
        "flex w-fit items-stretch",
        "[&>*:not(:first-child)]:-ml-px [&>*:not(:first-child)]:rounded-l-none",
        "[&>*:not(:last-child)]:rounded-r-none",
        className,
      )}
      {...props}
    />
  );
}

export { ButtonGroup };
