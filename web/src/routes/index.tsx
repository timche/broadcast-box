import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Users, Video } from "lucide-react";
import { PreviouslyWatched } from "@/components/previously-watched";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"watch" | "share">("watch");
  const [streamName, setStreamName] = useState("");

  const submit = () => {
    const name = streamName.trim();
    if (name === "") {
      return;
    }
    if (mode === "share") {
      void navigate({ to: "/publish/$streamKey", params: { streamKey: name } });
    } else {
      void navigate({ to: "/$", params: { _splat: name } });
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 pt-12">
      <Card className="py-8">
        <CardContent className="flex flex-col gap-4">
          <div>
            <h1 className="text-4xl font-light">Broadcast Box</h1>
            <p className="text-muted-foreground">Real-time WebRTC streaming.</p>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-lg border p-1">
            <Button
              variant={mode === "watch" ? "default" : "ghost"}
              onClick={() => setMode("watch")}
            >
              <Users className="size-4" />
              Watch
            </Button>
            <Button
              variant={mode === "share" ? "default" : "ghost"}
              onClick={() => setMode("share")}
            >
              <Video className="size-4" />
              Stream
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <Input
              autoFocus
              placeholder={mode === "share" ? "Choose a stream name" : "Enter a stream name to watch"}
              value={streamName}
              onChange={(event) => setStreamName(event.target.value)}
              onKeyUp={(event) => {
                if (event.key === "Enter") {
                  submit();
                }
              }}
            />
            <Button onClick={submit} disabled={streamName.trim() === ""}>
              {mode === "share" ? "Start streaming" : "Watch stream"}
            </Button>
          </div>

          <PreviouslyWatched />
        </CardContent>
      </Card>
    </div>
  );
}
