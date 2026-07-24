import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BookOpen, Check, Copy, Users, Video } from "lucide-react";
import { useState } from "react";
import { PreviouslyWatched } from "@/components/previously-watched";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { getLastStreamName, setLastStreamName } from "@/lib/last-stream";

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
            >
              <Users className="size-4" />
              Watch
            </Button>
            <Button
              variant={tab === "stream" ? "default" : "ghost"}
              onClick={() => selectTab("stream")}
            >
              <Video className="size-4" />
              Stream
            </Button>
            <Button variant={tab === "obs" ? "default" : "ghost"} onClick={() => selectTab("obs")}>
              <BookOpen className="size-4" />
              OBS Guide
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <Input
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

          <PreviouslyWatched />
        </CardContent>
      </Card>

      <ObsGuideDialog open={tab === "obs"} onClose={() => selectTab("stream")} />
    </div>
  );
}

function ObsGuideDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const whipUrl = `${window.location.origin}/api/whip`;

  const copyWhipUrl = () => {
    void navigator.clipboard.writeText(whipUrl).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => toast.add({ description: "Could not copy the URL.", type: "error" }),
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Stream with OBS</DialogTitle>
          <DialogDescription>
            Broadcast to Broadcast Box from OBS over WebRTC (WHIP).
          </DialogDescription>
        </DialogHeader>

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
            <div className="mt-1.5 flex items-center gap-2">
              <code className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1 text-xs">
                {whipUrl}
              </code>
              <Button
                size="icon-sm"
                variant="secondary"
                onClick={copyWhipUrl}
                aria-label="Copy server URL"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </li>
          <li>
            Set <span className="font-medium">Stream Key</span> to any name you like. That name{" "}
            <span className="font-medium">is your stream</span> — viewers watch it by the same name.
          </li>
          <li>
            Optional, for sub-second latency: in{" "}
            <span className="font-medium">Settings → Output</span> set the encoder to{" "}
            <code className="bg-muted rounded px-1 py-0.5">x264</code> and tune to{" "}
            <code className="bg-muted rounded px-1 py-0.5">zerolatency</code>.
          </li>
          <li>
            Press <span className="font-medium">Start Streaming</span>, then open{" "}
            <code className="bg-muted rounded px-1 py-0.5">
              {window.location.origin}/&lt;stream name&gt;
            </code>{" "}
            to watch.
          </li>
        </ol>
      </DialogContent>
    </Dialog>
  );
}
