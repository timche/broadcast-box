import { useNavigate } from "@tanstack/react-router";
import { MonitorUp, Webcam } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { addPublishTransceivers, negotiateWhip } from "@/lib/webrtc/whip";

const MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  audio: true,
  video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
};

type MediaSource = "None" | "Screen" | "Webcam";
type BannerTone = "error" | "warning" | "success";

function Banner({ tone, children }: { tone: BannerTone; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-md border px-4 py-2 text-sm",
        tone === "error" && "border-destructive/40 bg-destructive/15 text-destructive-foreground",
        tone === "warning" && "border-yellow-500/40 bg-yellow-500/15 text-yellow-200",
        tone === "success" && "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
      )}
    >
      {children}
    </div>
  );
}

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

  const [mediaError, setMediaError] = useState<string | null>(null);
  const [source, setSource] = useState<MediaSource>("None");
  const [requestCount, setRequestCount] = useState(0);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  const [hasPacketLoss, setHasPacketLoss] = useState(false);
  const [hasSignal, setHasSignal] = useState(false);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const badSignalCountRef = useRef(10);

  const shareUrl = `${window.location.origin}/${streamKey}`;

  const stopStream = useCallback((stream: MediaStream | null) => {
    stream?.getTracks().forEach((track) => track.stop());
  }, []);

  const requestMedia = (nextSource: Exclude<MediaSource, "None">) => {
    if (!navigator.mediaDevices) {
      setMediaError(getMediaErrorMessage(null));
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

        addPublishTransceivers(peerConnection, audioTrack, videoTrack);

        peerConnection.oniceconnectionstatechange = () => {
          const state = peerConnection.iceConnectionState;
          if (state === "connected" || state === "completed") {
            setPublishSuccess(true);
            setMediaError(null);
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
          }
        } catch {
          setConnectFailed(true);
        }
      },
      (error: unknown) => {
        setMediaError(getMediaErrorMessage(error));
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
    <div className="container mx-auto flex flex-col gap-2">
      {mediaError !== null && <Banner tone="error">{mediaError}</Banner>}
      {disconnected && <Banner tone="error">The connection to the server was lost.</Banner>}
      {connectFailed && <Banner tone="error">Failed to connect to the streaming server.</Banner>}
      {hasPacketLoss && (
        <Banner tone="warning">Your connection is experiencing packet loss.</Banner>
      )}
      {publishSuccess && (
        <Banner tone="success">
          You are live! Share your stream:{" "}
          <a href={shareUrl} target="_blank" rel="noreferrer" className="underline">
            {shareUrl}
          </a>
        </Banner>
      )}

      <video
        ref={videoRef}
        autoPlay
        muted
        controls
        playsInline
        className="aspect-video w-full rounded-md bg-black"
      />

      <div className="flex flex-row gap-2">
        <Button onClick={() => requestMedia("Screen")}>
          <MonitorUp className="size-4" />
          Share screen
        </Button>
        <Button variant="secondary" onClick={() => requestMedia("Webcam")}>
          <Webcam className="size-4" />
          Share webcam
        </Button>
      </div>

      {publishSuccess && (
        <Button variant="destructive" onClick={() => void navigate({ to: "/" })}>
          End stream
        </Button>
      )}
    </div>
  );
}
