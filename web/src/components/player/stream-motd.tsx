import { cn } from "@/lib/utils";

interface StreamMotdProps {
  isOnline: boolean;
  motd: string;
  className?: string;
}

export function StreamMotd({ isOnline, motd, className }: StreamMotdProps) {
  if (!isOnline || !motd) {
    return null;
  }

  return (
    <div className={cn("text-muted-foreground truncate text-sm", className)} title={motd}>
      {motd}
    </div>
  );
}
