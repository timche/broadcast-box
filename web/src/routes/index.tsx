import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BookOpen, Check, Copy, Info, Users, Video } from "lucide-react";
import { useState } from "react";
import { PreviouslyWatched } from "@/components/previously-watched";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { useStreamOnline } from "@/hooks/use-stream-online";
import { getLastStreamName, setLastStreamName } from "@/lib/last-stream";
import { cn } from "@/lib/utils";

type HomeTab = "watch" | "stream" | "obs";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { tab?: HomeTab } => {
    const tab = search.tab;
    return {
      tab: tab === "watch" || tab === "stream" || tab === "obs" ? tab : undefined,
    };
  },
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const { tab = "watch" } = Route.useSearch();
  // The Stream and OBS tabs both revolve around a stream name; only Watch starts blank.
  const [streamName, setStreamName] = useState(() => (tab === "watch" ? "" : getLastStreamName()));

  const isWatch = tab === "watch";

  const selectTab = (next: HomeTab) => {
    void navigate({ to: "/", search: { tab: next }, replace: true });
    setStreamName(next === "watch" ? "" : getLastStreamName());
  };

  const watchStream = () => {
    const name = streamName.trim();
    if (name === "") {
      return;
    }
    setLastStreamName(name);
    void navigate({ to: "/$", params: { _splat: name } });
  };

  const submit = () => {
    const name = streamName.trim();
    if (name === "") {
      return;
    }
    if (isWatch) {
      void navigate({ to: "/$", params: { _splat: name } });
    } else {
      setLastStreamName(name);
      void navigate({ to: "/publish/$streamKey", params: { streamKey: name } });
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 pt-12">
      <Card className="py-8">
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2 rounded-lg border p-1">
            <Button
              variant={tab === "watch" ? "default" : "ghost"}
              onClick={() => selectTab("watch")}
              className="h-auto py-2 text-center text-xs leading-tight whitespace-normal sm:text-sm"
            >
              <Users className="size-4" />
              Watch
            </Button>
            <Button
              variant={tab === "stream" ? "default" : "ghost"}
              onClick={() => selectTab("stream")}
              className="h-auto py-2 text-center text-xs leading-tight whitespace-normal sm:text-sm"
            >
              <Video className="size-4" />
              Stream with Browser
            </Button>
            <Button
              variant={tab === "obs" ? "default" : "ghost"}
              onClick={() => selectTab("obs")}
              className="h-auto py-2 text-center text-xs leading-tight whitespace-normal sm:text-sm"
            >
              <BookOpen className="size-4" />
              Stream with OBS
            </Button>
          </div>

          {tab === "obs" ? (
            <ObsGuide
              streamName={streamName}
              onStreamNameChange={setStreamName}
              onWatch={watchStream}
            />
          ) : (
            <>
              {tab === "stream" && <BrowserStreamAlert />}

              <div className="flex flex-col gap-2">
                <Label htmlFor="stream-name">Stream name</Label>
                <Input
                  id="stream-name"
                  autoFocus
                  placeholder={isWatch ? "Enter a stream name to watch" : "Choose a stream name"}
                  value={streamName}
                  onChange={(event) => setStreamName(event.target.value)}
                  onKeyUp={(event) => {
                    if (event.key === "Enter") {
                      submit();
                    }
                  }}
                />
                <Button onClick={submit} disabled={streamName.trim() === ""}>
                  {isWatch ? "Watch stream" : "Start streaming"}
                </Button>
              </div>

              {isWatch && <PreviouslyWatched />}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BrowserStreamAlert() {
  return (
    <Alert>
      <Info />
      <AlertTitle>Best for quick, casual streams</AlertTitle>
      <AlertDescription>
        Share your screen, a tab, or your webcam in a couple of clicks — no setup needed. For
        fast-paced content like games, or the highest quality (1080p60), use{" "}
        <span className="font-medium">Stream with OBS</span> instead.
      </AlertDescription>
    </Alert>
  );
}

function ObsStreamAlert() {
  return (
    <Alert>
      <Info />
      <AlertTitle>Best for high quality and games</AlertTitle>
      <AlertDescription>
        OBS gives you full control — high bitrate, 60fps, scenes and overlays — so it's the right
        choice for games and anything fast-paced. For a quick share,{" "}
        <span className="font-medium">Stream with Browser</span> is faster to set up.
      </AlertDescription>
    </Alert>
  );
}

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (value === "") {
      return;
    }
    void navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => toast.add({ description: "Could not copy.", type: "error" }),
    );
  };

  return (
    <InputGroup className="mt-1.5 h-8 min-w-0">
      <InputGroupInput
        readOnly
        value={value}
        onFocus={(event) => event.currentTarget.select()}
        aria-label={label}
        className="min-w-0 px-2 text-xs"
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          onClick={copy}
          disabled={value === ""}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

function ObsGuide({
  streamName,
  onStreamNameChange,
  onWatch,
}: {
  streamName: string;
  onStreamNameChange: (value: string) => void;
  onWatch: () => void;
}) {
  const whipUrl = `${window.location.origin}/api/whip`;
  const trimmedName = streamName.trim();
  // Poll the stream status so the user can see OBS connect after they hit Start.
  const isLive = useStreamOnline(trimmedName);

  return (
    <div className="flex flex-col gap-4">
      <ObsStreamAlert />

      <div className="flex flex-col gap-2">
        <Label htmlFor="stream-name">Stream name</Label>
        <Input
          id="stream-name"
          autoFocus
          placeholder="Choose a stream name"
          value={streamName}
          onChange={(event) => onStreamNameChange(event.target.value)}
          onKeyUp={(event) => {
            if (event.key === "Enter") {
              onWatch();
            }
          }}
        />
      </div>

      <ol className="flex list-decimal flex-col gap-3 ps-5 text-sm">
        <li>
          In OBS, open <span className="font-medium">Settings → Stream</span>.
        </li>
        <li>
          Set <span className="font-medium">Service</span> to{" "}
          <code className="bg-muted rounded px-1 py-0.5">WHIP</code>.
        </li>
        <li>
          Set <span className="font-medium">Server</span> to:
          <CopyField value={whipUrl} label="Server URL" />
        </li>
        <li>
          Set <span className="font-medium">Stream Key</span> to your stream name:
          <CopyField value={trimmedName} label="Stream key" />
        </li>
        <li>
          Optional, for sub-second latency: in{" "}
          <span className="font-medium">Settings → Output</span> set the encoder to{" "}
          <code className="bg-muted rounded px-1 py-0.5">x264</code> and tune to{" "}
          <code className="bg-muted rounded px-1 py-0.5">zerolatency</code>.
        </li>
        <li>
          Press <span className="font-medium">Start Streaming</span> in OBS.
        </li>
      </ol>

      <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
        <span
          className={cn(
            "size-2.5 shrink-0 rounded-full",
            trimmedName === ""
              ? "bg-muted-foreground/40"
              : isLive
                ? "bg-green-500"
                : "animate-pulse bg-yellow-400",
          )}
        />
        <span className="text-muted-foreground">
          {trimmedName === ""
            ? "Enter a stream name to check its status."
            : isLive
              ? "Your stream is live — OBS is connected."
              : "Waiting for OBS… press Start Streaming."}
        </span>
      </div>

      <Button onClick={onWatch} disabled={trimmedName === ""}>
        Go to stream and chat
      </Button>
    </div>
  );
}
