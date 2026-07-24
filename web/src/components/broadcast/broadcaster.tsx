import { useNavigate } from "@tanstack/react-router";
import { Check, Copy, Eye, EyeOff, MessageSquare, MonitorUp, Webcam } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Chat } from "@/components/chat/chat";
import { HeaderPortal } from "@/components/layout/header-portal";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import type { StreamStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { createChatDataChannel } from "@/lib/webrtc/chat";
import { addPublishTransceivers, negotiateWhip } from "@/lib/webrtc/whip";

const HEADER_HEIGHT = "2.75rem";

const MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  audio: true,
  video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
};

type MediaSource = "None" | "Screen" | "Webcam";

function getMediaErrorMessage(error: unknown): string {
  if (!navigator.mediaDevices) {
    return "Media devices are unavailable. Publishing requires HTTPS or localhost.";
  }
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
      return "Permission to access the camera or screen was denied.";
    case "NotFoundError":
      return "No camera or microphone was found.";
    case "NotReadableError":
      return "The selected media device is already in use.";
    default:
      return "Could not access the selected media source.";
  }
}

function getSender(
  peerConnection: RTCPeerConnection,
  kind: "audio" | "video",
): RTCRtpSender | null {
  const transceiver = peerConnection
    .getTransceivers()
    .find((entry) => entry.sender.track?.kind === kind);
  return transceiver?.sender ?? null;
}

interface BroadcasterProps {
  streamKey: string;
}

export function Broadcaster({ streamKey }: BroadcasterProps) {
  const navigate = useNavigate();

  const [source, setSource] = useState<MediaSource>("None");
  const [requestCount, setRequestCount] = useState(0);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  const [hasPacketLoss, setHasPacketLoss] = useState(false);
  const [hasSignal, setHasSignal] = useState(false);
  const [previewHidden, setPreviewHidden] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [copied, setCopied] = useState(false);
  const [chatChannel, setChatChannel] = useState<RTCDataChannel | null>(null);
  const [chatOpen, setChatOpen] = useState(true);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const badSignalCountRef = useRef(10);

  const shareUrl = `${window.location.origin}/${streamKey}`;

  const copyShareUrl = () => {
    void navigator.clipboard.writeText(shareUrl).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => toast.add({ description: "Could not copy the stream URL.", type: "error" }),
    );
  };

  // Surface state transitions as toasts.
  useEffect(() => {
    if (publishSuccess) {
      toast.add({ description: "You are live!", type: "success" });
    }
  }, [publishSuccess]);
  useEffect(() => {
    if (disconnected) {
      toast.add({ description: "The connection to the server was lost.", type: "error" });
    }
  }, [disconnected]);
  useEffect(() => {
    if (connectFailed) {
      toast.add({ description: "Failed to connect to the streaming server.", type: "error" });
    }
  }, [connectFailed]);
  useEffect(() => {
    if (hasPacketLoss) {
      toast.add({ description: "Your connection is experiencing packet loss.", type: "error" });
    }
  }, [hasPacketLoss]);

  const stopStream = useCallback((stream: MediaStream | null) => {
    stream?.getTracks().forEach((track) => track.stop());
  }, []);

  const requestMedia = (nextSource: Exclude<MediaSource, "None">) => {
    if (!navigator.mediaDevices) {
      toast.add({ description: getMediaErrorMessage(null), type: "error" });
      return;
    }
    setSource(nextSource);
    setRequestCount((count) => count + 1);
  };

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      stopStream(localStreamRef.current);
      localStreamRef.current = null;
      peerConnectionRef.current?.close();
      peerConnectionRef.current = null;
    };
  }, [stopStream]);

  useEffect(() => {
    if (source === "None") {
      return;
    }
    let cancelled = false;

    const mediaPromise =
      source === "Screen"
        ? navigator.mediaDevices.getDisplayMedia(MEDIA_CONSTRAINTS)
        : navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS);

    mediaPromise.then(
      async (stream) => {
        if (cancelled) {
          stopStream(stream);
          return;
        }

        const videoTrack = stream.getVideoTracks()[0] ?? null;
        const audioTrack = stream.getAudioTracks()[0] ?? null;

        const existing = peerConnectionRef.current;
        if (existing !== null) {
          await Promise.all([
            getSender(existing, "video")?.replaceTrack(videoTrack) ?? Promise.resolve(),
            getSender(existing, "audio")?.replaceTrack(audioTrack) ?? Promise.resolve(),
          ]);
          if (videoRef.current !== null) {
            videoRef.current.srcObject = stream;
          }
          const previous = localStreamRef.current;
          localStreamRef.current = stream;
          stopStream(previous);
          return;
        }

        const peerConnection = new RTCPeerConnection();
        peerConnectionRef.current = peerConnection;
        if (videoRef.current !== null) {
          videoRef.current.srcObject = stream;
        }
        localStreamRef.current = stream;

        // Open the chat data channel before negotiation so the backend binds it.
        setChatChannel(createChatDataChannel(peerConnection));

        addPublishTransceivers(peerConnection, audioTrack, videoTrack);

        peerConnection.oniceconnectionstatechange = () => {
          const state = peerConnection.iceConnectionState;
          if (state === "connected" || state === "completed") {
            setPublishSuccess(true);
            setDisconnected(false);
          } else if (state === "disconnected" || state === "failed") {
            setPublishSuccess(false);
            setDisconnected(true);
          }
        };

        try {
          const eventSource = await negotiateWhip(peerConnection, streamKey);
          eventSourceRef.current?.close();
          eventSourceRef.current = eventSource;
          if (eventSource !== null) {
            eventSource.onerror = () => eventSource.close();
            eventSource.addEventListener("status", (event: MessageEvent<string>) => {
              const status = JSON.parse(event.data) as StreamStatus;
              setIsOnline(status.isOnline);
              setViewers(status.viewers);
            });
          }
        } catch {
          setConnectFailed(true);
        }
      },
      (error: unknown) => {
        toast.add({ description: getMediaErrorMessage(error), type: "error" });
        setSource("None");
      },
    );

    return () => {
      cancelled = true;
    };
  }, [source, requestCount, streamKey, stopStream]);

  // Signal-quality / packet-loss monitor.
  useEffect(() => {
    const check = () => {
      const peerConnection = peerConnectionRef.current;
      if (peerConnection === null) {
        return;
      }
      peerConnection.getSenders().forEach((sender) => {
        void sender.getStats().then((stats) => {
          let packetLoss = false;
          stats.forEach((report) => {
            if (report.type === "outbound-rtp") {
              packetLoss = report.totalPacketSendDelay > 10;
            }
            if (report.type === "candidate-pair") {
              const signalIsValid = report.availableIncomingBitrate !== undefined;
              badSignalCountRef.current = signalIsValid ? 0 : badSignalCountRef.current + 1;
              if (badSignalCountRef.current > 2) {
                setHasSignal(false);
              } else if (badSignalCountRef.current === 0) {
                setHasSignal(true);
              }
            }
          });
          setHasPacketLoss(packetLoss);
        });
      });
    };

    const interval = window.setInterval(check, hasSignal ? 15_000 : 2_500);
    return () => window.clearInterval(interval);
  }, [hasSignal]);

  return (
    <div className="flex w-full flex-col" style={{ height: `calc(100dvh - ${HEADER_HEIGHT})` }}>
      <HeaderPortal>
        <InputGroup className="h-7 w-auto max-w-[60vw]">
          <InputGroupInput
            readOnly
            value={shareUrl}
            onFocus={(event) => event.currentTarget.select()}
            aria-label="Stream URL"
            className="field-sizing-content w-auto flex-none px-2 text-xs"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" onClick={copyShareUrl} aria-label="Copy stream URL">
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </HeaderPortal>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-black">
          <div className="relative min-h-0 flex-1">
            <video
              ref={videoRef}
              autoPlay
              muted
              controls
              playsInline
              className={cn("size-full object-contain", previewHidden && "hidden")}
            />
            {previewHidden && (
              <div className="text-muted-foreground flex size-full items-center justify-center">
                Preview hidden
              </div>
            )}

            {publishSuccess && (
              <span className="pointer-events-none absolute top-2 left-2 z-20 rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold tracking-wide text-white uppercase">
                Live
              </span>
            )}
            {isOnline && (
              <span className="pointer-events-none absolute top-2 right-2 z-20 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white">
                <Eye className="size-3.5" />
                {viewers}
              </span>
            )}
          </div>

          <div className="bg-background flex w-full gap-2 p-2">
            <Button className="flex-1" onClick={() => requestMedia("Screen")}>
              <MonitorUp className="size-4" />
              <span className="hidden sm:inline">Share screen</span>
            </Button>
            <Button className="flex-1" variant="secondary" onClick={() => requestMedia("Webcam")}>
              <Webcam className="size-4" />
              <span className="hidden sm:inline">Share webcam</span>
            </Button>
            <Button
              className="flex-1"
              variant="secondary"
              onClick={() => setPreviewHidden((hidden) => !hidden)}
            >
              {previewHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              <span className="hidden sm:inline">
                {previewHidden ? "Show preview" : "Hide preview"}
              </span>
            </Button>
            <Button
              variant={chatOpen ? "default" : "secondary"}
              onClick={() => setChatOpen((open) => !open)}
              aria-label={chatOpen ? "Hide chat" : "Show chat"}
            >
              <MessageSquare className="size-4" />
            </Button>
            {publishSuccess && (
              <Button
                className="flex-1"
                variant="destructive"
                onClick={() => void navigate({ to: "/" })}
              >
                <span className="hidden sm:inline">End stream</span>
                <span className="sm:hidden">End</span>
              </Button>
            )}
          </div>
        </div>

        {chatOpen && (
          <aside className="min-h-0 flex-1 border-t md:w-80 md:flex-none md:border-t-0 md:border-l">
            <Chat channel={chatChannel} />
          </aside>
        )}
      </div>
    </div>
  );
}
