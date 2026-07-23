import { Maximize2, PictureInPicture2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LayerSelector } from "@/components/player/layer-selector";
import { StatusMessage } from "@/components/player/status-message";
import { VolumeControl } from "@/components/player/volume-control";
import type { CurrentLayersMessage, StreamState, StreamStatus } from "@/lib/types";
import { setupWhepConnection, type WhepHandlers } from "@/lib/webrtc/whep";

const OVERLAY_HIDE_MS = 2500;
const CLICK_DELAY_MS = 250;

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => void;
  webkitEnterFullscreen?: () => void;
}

interface PlayerProps {
  streamKey: string;
  cinemaMode: boolean;
  fillContainer?: boolean;
  onStreamStatusChange?: (streamKey: string, status: StreamStatus) => void;
  onCloseStream?: () => void;
}

export function Player({
  streamKey: rawStreamKey,
  cinemaMode,
  fillContainer = false,
  onStreamStatusChange,
  onCloseStream,
}: PlayerProps) {
  const streamKey = decodeURIComponent(rawStreamKey).replace(/ /g, "_");

  const [streamState, setStreamState] = useState<StreamState>("Loading");
  const [viewers, setViewers] = useState(0);
  const [audioLayers, setAudioLayers] = useState<string[]>([]);
  const [videoLayers, setVideoLayers] = useState<string[]>([]);
  const [currentLayers, setCurrentLayers] = useState<CurrentLayersMessage>();
  const [layerEndpoint, setLayerEndpoint] = useState("");
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(50);
  const [overlayVisible, setOverlayVisible] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayTimeoutRef = useRef<number>(undefined);
  const clickTimeoutRef = useRef<number>(undefined);
  const statusChangeRef = useRef(onStreamStatusChange);
  statusChangeRef.current = onStreamStatusChange;

  const playerId = `${streamKey}_player`;

  const enterFullscreen = () => {
    const element = videoRef.current as FullscreenElement | null;
    if (element === null) {
      return;
    }
    if (element.requestFullscreen) {
      void element.requestFullscreen().catch(() => undefined);
    } else if (element.webkitRequestFullscreen) {
      element.webkitRequestFullscreen();
    } else if (element.webkitEnterFullscreen) {
      element.webkitEnterFullscreen();
    }
  };

  const showOverlay = (visible: boolean) => {
    setOverlayVisible(visible);
    window.clearTimeout(overlayTimeoutRef.current);
    if (visible) {
      overlayTimeoutRef.current = window.setTimeout(
        () => setOverlayVisible(false),
        OVERLAY_HIDE_MS,
      );
    }
  };

  const handleClick = () => {
    window.clearTimeout(clickTimeoutRef.current);
    clickTimeoutRef.current = window.setTimeout(() => {
      const video = videoRef.current;
      if (video === null) {
        return;
      }
      if (video.paused) {
        void video.play();
      } else {
        video.pause();
      }
    }, CLICK_DELAY_MS);
  };

  const handleDoubleClick = () => {
    window.clearTimeout(clickTimeoutRef.current);
    enterFullscreen();
  };

  useEffect(() => {
    let currentConnection: RTCPeerConnection | null = null;
    let cancelled = false;

    const handlers: Omit<WhepHandlers, "onStreamRestart"> = {
      videoRef,
      onLayerEndpoint: setLayerEndpoint,
      onLayers: (audio, video) => {
        setAudioLayers(audio);
        setVideoLayers(video);
      },
      onCurrentLayers: setCurrentLayers,
      onOffline: () => setStreamState("Offline"),
      onStreamStatus: (status) => {
        setViewers(status.viewers);
        statusChangeRef.current?.(streamKey, status);

        if (!status.isOnline) {
          setStreamState("Offline");
          return;
        }
        const video = videoRef.current;
        if (
          video !== null &&
          !video.paused &&
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          setStreamState("Playing");
          return;
        }
        setStreamState("Loading");
      },
    };

    const connect = () => {
      setupWhepConnection(streamKey, { ...handlers, onStreamRestart: connect })
        .then((connection) => {
          if (cancelled) {
            connection.close();
            return;
          }
          currentConnection = connection;
        })
        .catch(() => setStreamState("Error"));
    };

    connect();

    const beforeUnload = () => currentConnection?.close();
    window.addEventListener("beforeunload", beforeUnload);

    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", beforeUnload);
      currentConnection?.close();
      window.clearTimeout(overlayTimeoutRef.current);
    };
  }, [streamKey]);

  return (
    <div
      id={playerId}
      className={`group relative w-full overflow-hidden rounded-md bg-black ${fillContainer ? "h-full" : "aspect-video"}`}
      style={cinemaMode ? { maxHeight: "100vh", maxWidth: "100vw" } : undefined}
      onMouseMove={() => showOverlay(true)}
      onMouseEnter={() => showOverlay(true)}
      onMouseLeave={() => showOverlay(false)}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isMuted}
        className="size-full bg-black"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onPlaying={() => setStreamState("Playing")}
        onLoadStart={() => setStreamState("Loading")}
        onVolumeChange={(event) => {
          setIsMuted(event.currentTarget.muted);
          setVolume(Math.round(event.currentTarget.volume * 100));
        }}
        onLoadedData={(event) => {
          event.currentTarget.volume = volume / 100;
          void event.currentTarget.play();
        }}
        onEnded={() => setStreamState("Offline")}
      />

      <StatusMessage streamKey={streamKey} state={streamState} />

      {/* Top-right actions */}
      <div className="absolute top-2 right-2 z-30 flex gap-2">
        {onCloseStream && (
          <button
            type="button"
            onClick={onCloseStream}
            className="bg-destructive/80 hover:bg-destructive rounded-full p-2 text-white"
            aria-label="Close stream"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Bottom control bar (also the react-grid-layout drag handle) */}
      <div
        className={`player-drag-handle absolute inset-x-0 bottom-0 z-30 flex h-10 cursor-move items-center gap-3 bg-black/70 px-3 text-white transition-opacity duration-300 ${
          overlayVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="player-drag-cancel flex items-center gap-3">
          <VolumeControl
            isMuted={isMuted}
            volume={volume}
            disabled={audioLayers.length === 0}
            onVolumeChange={(value) => {
              const video = videoRef.current;
              if (video !== null) {
                video.muted = value === 0;
                video.volume = value / 100;
              }
            }}
            onToggleMute={() => {
              const video = videoRef.current;
              if (video !== null) {
                video.muted = !video.muted;
              }
            }}
          />
        </div>

        <div className="flex-1" />

        <span className="player-drag-cancel text-sm tabular-nums">{viewers}</span>

        <div className="player-drag-cancel flex items-center gap-1">
          <LayerSelector
            kind="video"
            layers={videoLayers}
            layerEndpoint={layerEndpoint}
            currentLayer={currentLayers?.videoLayerCurrent ?? ""}
          />
          <LayerSelector
            kind="audio"
            layers={audioLayers}
            layerEndpoint={layerEndpoint}
            currentLayer={currentLayers?.audioLayerCurrent ?? ""}
          />
          <button
            type="button"
            className="player-drag-cancel flex items-center"
            onClick={() => void videoRef.current?.requestPictureInPicture().catch(() => undefined)}
            aria-label="Picture in picture"
          >
            <PictureInPicture2 className="size-4" />
          </button>
          <button
            type="button"
            className="player-drag-cancel flex items-center"
            onClick={enterFullscreen}
            aria-label="Fullscreen"
          >
            <Maximize2 className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
