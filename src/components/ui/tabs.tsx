import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "relative isolate inline-flex h-8 items-center justify-center rounded-lg bg-muted p-0.5 text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative z-[1] inline-flex items-center justify-center whitespace-nowrap rounded-md px-2.5 py-1 text-[13px] font-medium transition-[color] hover:text-foreground data-[pointer]:focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground",
      className
    )}
    // Radix calls focus() on mousedown, which Chrome treats as keyboard focus. Keys still show the ring.
    onPointerDown={(e) => { e.currentTarget.dataset.pointer = "" }}
    onKeyDown={(e) => { delete e.currentTarget.dataset.pointer }}
    onBlur={(e) => { delete e.currentTarget.dataset.pointer }}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

export { Tabs, TabsList, TabsTrigger }
