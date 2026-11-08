import { useState } from "react";
import { Home, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCents, yuanToCents } from "../evidence/store";
import {
  rentalProfileFilled,
  saveRentalProfile,
  useRentalProfile,
  type RentalProfile,
} from "./profile";

export function RentalProfileCard() {
  const profile = useRentalProfile();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RentalProfile>(profile);

  function edit() {
    setDraft(profile);
    setOpen(true);
  }

  function save() {
    saveRentalProfile({
      addressLabel: draft.addressLabel.trim(),
      startDate: draft.startDate,
      monthlyRentCents: draft.monthlyRentCents,
      depositCents: draft.depositCents,
    });
    setOpen(false);
  }

  const filled = rentalProfileFilled(profile);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border/70 bg-secondary/30 px-3 py-2 text-[11px]">
      <span className="flex items-center gap-1.5 font-medium text-foreground">
        <Home className="size-3.5 text-muted-foreground" />
        租住信息
      </span>
      {filled ? (
        <>
          {profile.addressLabel && <span className="text-muted-foreground">{profile.addressLabel}</span>}
          {profile.startDate && <span className="text-muted-foreground">起租 {profile.startDate}</span>}
          {profile.monthlyRentCents != null && <span className="text-muted-foreground">月租 {formatCents(profile.monthlyRentCents)}</span>}
          {profile.depositCents != null && <span className="text-muted-foreground">押金 {formatCents(profile.depositCents)}</span>}
        </>
      ) : (
        <span className="text-muted-foreground">填一次，合同与争议自动复用地址、起租日、月租与押金。</span>
      )}
      <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-[11px]" onClick={edit}>
        <Pencil className="size-3" />
        {filled ? "编辑" : "填写"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>租住信息</DialogTitle>
            <DialogDescription>仅保存在本浏览器，合同与争议模块共用，可随时修改。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="rp-address" className="text-xs">房屋地址标签</Label>
              <Input
                id="rp-address"
                value={draft.addressLabel}
                onChange={(event) => setDraft({ ...draft, addressLabel: event.target.value })}
                placeholder="例如：金水区某小区 3 号楼 502"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rp-start" className="text-xs">起租日</Label>
              <Input
                id="rp-start"
                type="date"
                value={draft.startDate}
                onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rp-rent" className="text-xs">月租（元）</Label>
              <Input
                id="rp-rent"
                inputMode="decimal"
                defaultValue={draft.monthlyRentCents != null ? (draft.monthlyRentCents / 100).toFixed(2) : ""}
                onChange={(event) => setDraft({ ...draft, monthlyRentCents: yuanToCents(event.target.value) })}
                placeholder="留空表示未知"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rp-deposit" className="text-xs">押金（元）</Label>
              <Input
                id="rp-deposit"
                inputMode="decimal"
                defaultValue={draft.depositCents != null ? (draft.depositCents / 100).toFixed(2) : ""}
                onChange={(event) => setDraft({ ...draft, depositCents: yuanToCents(event.target.value) })}
                placeholder="留空表示未知"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={save}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
