import { forwardRef, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Props = Omit<ComponentProps<typeof Button>, "variant" | "size"> & {
  label: string;
  tip?: string;
  side?: "top" | "right" | "bottom" | "left";
  size?: "icon" | "icon-sm";
};

export const IconButton = forwardRef<HTMLButtonElement, Props>(({ label, tip, side, size = "icon", className, ...props }, ref) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button ref={ref} variant="ghost" size={size} aria-label={label} className={cn("ghost-icon text-muted-foreground", className)} {...props} />
    </TooltipTrigger>
    <TooltipContent side={side}>{tip ?? label}</TooltipContent>
  </Tooltip>
));
IconButton.displayName = "IconButton";
