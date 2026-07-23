import { Copy, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useAddProfileMutation,
  useAdminProfilesQuery,
  useRemoveProfileMutation,
  useResetTokenMutation,
} from "@/lib/queries/admin";

export function ProfilesPage() {
  const { data } = useAdminProfilesQuery(true);
  const addProfile = useAddProfileMutation();
  const removeProfile = useRemoveProfileMutation();
  const resetToken = useResetTokenMutation();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newStreamKey, setNewStreamKey] = useState("");
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const handleAdd = () => {
    const trimmed = newStreamKey.trim();
    if (trimmed === "") {
      return;
    }
    addProfile.mutate(trimmed, {
      onSuccess: () => {
        setNewStreamKey("");
        setIsAddOpen(false);
      },
    });
  };

  const handleRemove = () => {
    if (removeTarget !== null) {
      removeProfile.mutate(removeTarget);
      setRemoveTarget(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Profiles</h2>
        <Button onClick={() => setIsAddOpen(true)}>Add profile</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Stream key</TableHead>
            <TableHead>Public</TableHead>
            <TableHead>MOTD</TableHead>
            <TableHead>Token</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.map((profile) => (
            <TableRow key={profile.streamKey}>
              <TableCell className="font-medium">{profile.streamKey}</TableCell>
              <TableCell>{profile.isPublic ? "Yes" : "No"}</TableCell>
              <TableCell>{profile.motd}</TableCell>
              <TableCell>
                <button
                  type="button"
                  className="flex items-center gap-1 text-left hover:underline"
                  title="Copy token"
                  onClick={() => void navigator.clipboard.writeText(profile.token)}
                >
                  <Copy className="size-3.5 shrink-0" />
                  <span className="font-mono text-xs">{profile.token}</span>
                </button>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Reset token"
                    onClick={() => resetToken.mutate(profile.streamKey)}
                  >
                    <RotateCw className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove profile"
                    onClick={() => setRemoveTarget(profile.streamKey)}
                  >
                    <Trash2 className="text-destructive size-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add profile</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Stream key"
            value={newStreamKey}
            onChange={(event) => setNewStreamKey(event.target.value)}
            onKeyUp={(event) => {
              if (event.key === "Enter") {
                handleAdd();
              }
            }}
          />
          {addProfile.isError && <p className="text-destructive text-sm">Could not add profile.</p>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removeTarget !== null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove profile</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            Remove the profile for <span className="font-mono">{removeTarget}</span>?
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRemove}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
