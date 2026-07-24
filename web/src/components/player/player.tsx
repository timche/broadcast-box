import { Eye, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { StatusMessage } from "@/components/player/status-message";
import { toast } from "@/components/ui/toast";
import { useControlsVisibility } from "@/hooks/use-controls-visibility";
import type { StreamState, StreamStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { setupWhepConnection } from "@/lib/webrtc/whep";

interface PlayerProps {
  streamKey: string;
  showClose?: boolean;
  onClose?: () => void;
  onStreamStatusChange?: (streamKey: string, status: StreamStatus) => void;
  /** Receives the chat data channel (or `null` on teardown) when chat is enabled. */
  onChatChannel?: (channel: RTCDataChannel | null) => void;
}

export function Player({
  streamKey: rawStreamKey,
  showClose = false,
  onClose,
  onStreamStatusChange,
  onChatChannel,
}: PlayerProps) {
  const streamKey = decodeURIComponent(rawStreamKey).replace(/ /g, "_");

  const [streamState, setStreamState] = useState<StreamState>("Loading");
  const [isOnline, setIsOnline] = useState(false);
  const [viewers, setViewers] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const statusChangeRef = useRef(onStreamStatusChange);
  statusChangeRef.current = onStreamStatusChange;
  const chatChannelRef = useRef(onChatChannel);
  chatChannelRef.current = onChatChannel;
  const chatEnabled = onChatChannel != null;

  const { visible: controlsVisible, containerProps } = useControlsVisibility();

  useEffect(() => {
    let currentConnection: RTCPeerConnection | null = null;
    let cancelled = false;

    const video = videoRef.current;
    if (video !== null) {
      video.muted = true;
    }

    const connect = () => {
      setupWhepConnection(streamKey, {
        videoRef,
        onChatChannel: chatEnabled
          ? (channel) => chatChannelRef.current?.(channel)
          : undefined,
        onOffline: () => {
          setIsOnline(false);
          setStreamState("Offline");
        },
        onStreamRestart: connect,
        onStreamStatus: (status) => {
          setIsOnline(status.isOnline);
          setViewers(status.viewers);
          statusChangeRef.current?.(streamKey, status);

          if (!status.isOnline) {
            setStreamState("Offline");
            return;
          }
          const currentVideo = videoRef.current;
          if (
            currentVideo !== null &&
            !currentVideo.paused &&
            currentVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          ) {
            setStreamState("Playing");
            return;
          }
          setStreamState("Loading");
        },
      })
        .then((connection) => {
          if (cancelled) {
            connection.close();
            return;
          }
          currentConnection = connection;
        })
        .catch(() => {
          setStreamState("Error");
          toast.add({ description: `Could not connect to "${streamKey}".`, type: "error" });
        });
    };

    connect();

    const beforeUnload = () => currentConnection?.close();
    window.addEventListener("beforeunload", beforeUnload);

    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", beforeUnload);
      currentConnection?.close();
      chatChannelRef.current?.(null);
    };
  }, [streamKey, chatEnabled]);

  const fadeClass = cn(
    "transition-opacity duration-300",
    controlsVisible ? "opacity-100" : "opacity-0",
  );

  return (
    <div className="relative size-full bg-black" {...containerProps}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        controls
        className="size-full bg-black object-contain"
        onPlaying={() => setStreamState("Playing")}
        onLoadStart={() => setStreamState("Loading")}
        onLoadedData={(event) => void event.currentTarget.play().catch(() => undefined)}
        onEnded={() => setStreamState("Offline")}
      />

      {streamState === "Playing" && (
        <span
          className={cn(
            "pointer-events-none absolute top-2 left-2 z-20 rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold tracking-wide text-white uppercase",
            fadeClass,
          )}
        >
          Live
        </span>
      )}

      <div className="absolute top-2 right-2 z-20 flex items-center gap-2">
        {isOnline && (
          <span
            className={cn(
              "pointer-events-none flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white",
              fadeClass,
            )}
          >
            <Eye className="size-3.5" />
            {viewers}
          </span>
        )}
        {showClose && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Remove stream"
            className="rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <StatusMessage streamKey={streamKey} state={streamState} />
    </div>
  );
}
