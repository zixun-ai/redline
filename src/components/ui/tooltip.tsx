import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 2, collisionPadding = 8, children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(
        "z-50 w-fit max-w-64 rounded-md bg-(--tip) px-2 py-1 text-xs font-medium text-balance text-(--tip-text) shadow-[0_2px_4px_rgba(28,25,23,.1),0_4px_12px_rgba(28,25,23,.14)] transition-none animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 origin-(--radix-tooltip-content-transform-origin) duration-[125ms] data-[state=instant-open]:animate-none",
        className
      )}
      {...props}
    >
      {children}
      {/* Pushed off the window's edge, the tooltip still points at its button. The tip is rounded, and the
          shape starts inside the body so no seam shows between them. */}
      <TooltipPrimitive.Arrow asChild width={10} height={5}>
        <svg viewBox="0 0 10 5" overflow="visible" className="fill-(--tip)"><path d="M0-1h10v1L5.85 4.15a1.2 1.2 0 0 1-1.7 0L0 0Z" /></svg>
      </TooltipPrimitive.Arrow>
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
