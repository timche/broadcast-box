import { Slider as BaseSlider } from "@base-ui/react/slider";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Slider({ className, ...props }: ComponentProps<typeof BaseSlider.Root>) {
  return (
    <BaseSlider.Root
      className={cn("relative flex w-full touch-none items-center select-none", className)}
      {...props}
    >
      <BaseSlider.Control className="flex w-full items-center py-1.5">
        <BaseSlider.Track className="bg-muted relative h-1.5 w-full grow rounded-full">
          <BaseSlider.Indicator className="bg-primary absolute h-full rounded-full" />
          <BaseSlider.Thumb className="border-primary bg-background focus-visible:ring-ring/50 size-4 rounded-full border shadow-sm transition-[color,box-shadow] outline-none focus-visible:ring-[3px]" />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}
