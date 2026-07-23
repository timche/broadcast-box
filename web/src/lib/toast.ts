import { Toast } from "@base-ui/react/toast";

/** Global toast manager, usable from anywhere (including non-component code). */
export const toastManager = Toast.createToastManager();

export const toast = {
  error(message: string): void {
    toastManager.add({ description: message, type: "error", timeout: 6000 });
  },
  success(message: string): void {
    toastManager.add({ description: message, type: "success" });
  },
  info(message: string): void {
    toastManager.add({ description: message, type: "info" });
  },
};
