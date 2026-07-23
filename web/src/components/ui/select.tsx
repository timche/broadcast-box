import { Select as BaseSelect } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Select = BaseSelect.Root;
export const SelectValue = BaseSelect.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseSelect.Trigger>) {
  return (
    <BaseSelect.Trigger
      className={cn(
        "border-input focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 *:data-[slot=select-value]:line-clamp-1",
        className,
      )}
      {...props}
    >
      {children}
      <BaseSelect.Icon>
        <ChevronDownIcon className="size-4 opacity-50" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseSelect.Popup>) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner className="z-50 outline-none" sideOffset={6}>
        <BaseSelect.Popup
          className={cn(
            "bg-popover text-popover-foreground max-h-[min(24rem,var(--available-height))] min-w-[8rem] overflow-y-auto rounded-md border p-1 shadow-md transition-all duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
            className,
          )}
          {...props}
        >
          <BaseSelect.List>{children}</BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseSelect.Item> & { children?: ReactNode }) {
  return (
    <BaseSelect.Item
      className={cn(
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <BaseSelect.ItemIndicator>
          <CheckIcon className="size-4" />
        </BaseSelect.ItemIndicator>
      </span>
    </BaseSelect.Item>
  );
}
