import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAdminStatusQuery } from "@/lib/queries/admin";

export function StatusPage() {
  const { data } = useAdminStatusQuery(true);
  const streams = [...(data ?? [])].sort((a, b) => a.streamKey.localeCompare(b.streamKey));

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold">Status</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Stream key</TableHead>
            <TableHead>Public</TableHead>
            <TableHead>Video</TableHead>
            <TableHead>Audio</TableHead>
            <TableHead>Sessions</TableHead>
            <TableHead>Packets</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {streams.map((stream) => {
            const packets =
              stream.videoTracks.reduce((sum, track) => sum + track.packetsReceived, 0) +
              stream.audioTracks.reduce((sum, track) => sum + track.packetsReceived, 0);
            return (
              <TableRow key={stream.streamKey}>
                <TableCell className="font-medium">{stream.streamKey}</TableCell>
                <TableCell>{stream.isPublic ? "Yes" : "No"}</TableCell>
                <TableCell>{stream.videoTracks.length}</TableCell>
                <TableCell>{stream.audioTracks.length}</TableCell>
                <TableCell>{stream.sessions.length}</TableCell>
                <TableCell>{packets}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
