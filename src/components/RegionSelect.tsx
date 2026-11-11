import { useEffect } from "react";
import { MapPin } from "lucide-react";
import { useConfig } from "../lib/config-context";
import { setRegion, useRegionCode } from "../lib/region";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const FALLBACK = { code: "CN", name: "不限 / 全国一般建议" };

export function RegionSelect({
  compact = false,
  id = "region",
  className,
}: {
  compact?: boolean;
  id?: string;
  className?: string;
}) {
  const { config } = useConfig();
  const code = useRegionCode();
  const cities = config?.cities?.length ? config.cities : [FALLBACK];
  const value = cities.some((city) => city.code === code) ? code : FALLBACK.code;
  const selected = cities.find((city) => city.code === value) ?? FALLBACK;
  const label = compact && value === "CN" ? "全国" : selected.name;

  useEffect(() => {
    if (config && value !== code) setRegion(value);
  }, [config, value, code]);

  return (
    <Select value={value} onValueChange={setRegion}>
      <SelectTrigger
        id={id}
        size="sm"
        aria-label="地区"
        className={cn(
          compact
            ? "h-8 w-auto gap-1.5 rounded-full border-border/70 bg-white/60 px-2.5 text-[12px]"
            : "w-full",
          className,
        )}
      >
        {compact ? (
          <span className="flex items-center gap-1.5">
            <MapPin className="size-3.5 text-muted-foreground" />
            <span>{label}</span>
          </span>
        ) : (
          <SelectValue />
        )}
      </SelectTrigger>
      {/* 紧凑模式不渲染 SelectValue，item-aligned 拿不到锚点会把菜单排到视口外；用 popper 锚定触发器。 */}
      <SelectContent position="popper" align="start" className="max-h-[min(18rem,var(--radix-select-content-available-height))]">
        {cities.map((city) => (
          <SelectItem key={city.code} value={city.code}>
            {city.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
