import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Placeholder until stage 5: the button is visible, the dialog only announces what is coming. */
export function AddSongDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="secondary"
          className="h-11 gap-2 rounded-full border-2 border-white/70 bg-(--scrim-button) px-5 text-base text-white hover:bg-(--scrim-button) hover:brightness-125 focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-5"
        >
          <Plus aria-hidden />
          Song hinzufügen
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Song hinzufügen</DialogTitle>
          <DialogDescription>Folgt in Etappe 5</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
