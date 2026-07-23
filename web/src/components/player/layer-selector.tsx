import { BarChart3, Music2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { selectLayer } from "@/lib/webrtc/whep";

interface LayerSelectorProps {
  kind: "video" | "audio";
  layers: string[];
  layerEndpoint: string;
  currentLayer: string;
}

export function LayerSelector({ kind, layers, layerEndpoint, currentLayer }: LayerSelectorProps) {
  if (layers.length <= 1) {
    return null;
  }

  const mediaId = kind === "video" ? "1" : "2";
  const Icon = kind === "video" ? BarChart3 : Music2;

  const handleChange = (value: string | null) => {
    if (value !== null && layerEndpoint) {
      void selectLayer(layerEndpoint, mediaId, value);
    }
  };

  return (
    <Select value={currentLayer} onValueChange={handleChange}>
      <SelectTrigger className="h-6 w-auto gap-1 border-0 bg-transparent px-1 text-white shadow-none focus-visible:ring-0">
        <Icon className="size-4" />
      </SelectTrigger>
      <SelectContent>
        {layers.map((layer) => (
          <SelectItem key={layer} value={layer}>
            {layer || "Auto"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
