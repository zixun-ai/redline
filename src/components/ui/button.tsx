import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium tracking-[-.01em] transition-[color,background-color,box-shadow,transform] duration-150 ease-(--ease-out) active:not-disabled:scale-[.97] motion-reduce:active:not-disabled:scale-100 disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-(--shadow-primary) hover:bg-(--primary-hover)",
        outline:
          // Secondary: raised by its ring and drop, never by a border or a grey fill.
          "bg-(--control) text-foreground shadow-(--shadow-button) hover:bg-(--control-hover)",
        ghost: "hover:bg-(--hover) hover:text-accent-foreground",
        // Tinted: the edge is drawn from its own text colour, so it reads raised on any ground.
        warn: "bg-warn-soft text-warn shadow-(--shadow-badge) hover:bg-[color-mix(in_srgb,var(--warn-soft)_88%,var(--warn))]",
        // The one next step when nothing else can run yet. Ink, like every primary; red stays for corrections.
        attention: "bg-primary text-primary-foreground shadow-(--shadow-primary) hover:bg-(--primary-hover)",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 rounded-md px-2 text-xs",
        // Smaller targets squeeze deeper, and fade further when off.
        icon: "h-7 w-7 active:not-disabled:scale-[.92] disabled:opacity-40",
        "icon-sm": "h-6 w-6 active:not-disabled:scale-[.92] disabled:opacity-40",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
