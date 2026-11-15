import * as React from "react"

import { cn } from "@/lib/utils"

/** `quiet` drops the box: the value reads as text, a well shows on hover, and the box comes back on focus. */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input"> & { quiet?: boolean }>(
  ({ className, type, quiet, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex w-full border text-[13px] file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/10 disabled:cursor-not-allowed disabled:opacity-50",
          quiet
            ? "h-7 rounded-(--r-xs) border-transparent bg-transparent px-1.5 transition-[background-color] duration-100 placeholder:text-(--faint) hover:bg-(--sunken) focus-visible:bg-raised"
            : "h-8 rounded-md border-transparent bg-(--well) px-2.5 py-1 transition-[background-color] duration-150 focus-visible:bg-(--well-focus)",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
