import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Users, Video } from "lucide-react";
import { useState } from "react";
import { PreviouslyWatched } from "@/components/previously-watched";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getLastStreamName, setLastStreamName } from "@/lib/last-stream";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"watch" | "share">("watch");
  const [streamName, setStreamName] = useState("");

  // Prefill the last stream name only on the Stream tab; keep Watch empty.
  const selectMode = (next: "watch" | "share") => {
    setMode(next);
    setStreamName(next === "share" ? getLastStreamName() : "");
  };

  const submit = () => {
    const name = streamName.trim();
    if (name === "") {
      return;
    }
    if (mode === "share") {
      setLastStreamName(name);
      void navigate({ to: "/publish/$streamKey", params: { streamKey: name } });
    } else {
      void navigate({ to: "/$", params: { _splat: name } });
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 pt-12">
      <Card className="py-8">
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 rounded-lg border p-1">
            <Button
              variant={mode === "watch" ? "default" : "ghost"}
              onClick={() => selectMode("watch")}
            >
              <Users className="size-4" />
              Watch
            </Button>
            <Button
              variant={mode === "share" ? "default" : "ghost"}
              onClick={() => selectMode("share")}
            >
              <Video className="size-4" />
              Stream
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <Input
              autoFocus
              placeholder={
                mode === "share" ? "Choose a stream name" : "Enter a stream name to watch"
              }
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
