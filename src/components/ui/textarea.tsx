import * as React from "react"

import { cn } from "@/lib/utils"

/** `quiet` drops the box, as Input's does: text until pointed at, a box again once focused. */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea"> & { quiet?: boolean }
>(({ className, quiet, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-md border text-[13px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/10 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:text-base",
        quiet
          ? "border-transparent bg-transparent px-1 py-1 transition-[background-color] duration-100 placeholder:text-(--faint) hover:bg-(--sunken) focus-visible:bg-raised"
          : "border-transparent bg-(--well) px-2.5 py-1.5 transition-[background-color] duration-150 focus-visible:bg-(--well-focus)",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
