import type { ReactNode } from "react";
import { Toast } from "@base-ui/react/toast";
import { X } from "lucide-react";
import { toastManager } from "@/lib/toast";
import { cn } from "@/lib/utils";

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider toastManager={toastManager}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="fixed right-3 bottom-3 z-[100] flex w-[calc(100%-1.5rem)] max-w-sm flex-col gap-2 sm:right-4 sm:bottom-4">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function ToastList() {
  const { toasts } = Toast.useToastManager();

  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className={cn(
        "flex items-start gap-3 rounded-md border bg-card p-3 text-sm shadow-lg transition-all data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
        toast.type === "error" && "border-destructive/60",
        toast.type === "success" && "border-emerald-500/60",
      )}
    >
      <div className="flex-1">
        {toast.title !== undefined && <Toast.Title className="font-medium" />}
        <Toast.Description className="text-muted-foreground" />
      </div>
      <Toast.Close className="text-muted-foreground hover:text-foreground" aria-label="Close">
        <X className="size-4" />
      </Toast.Close>
    </Toast.Root>
  ));
}
