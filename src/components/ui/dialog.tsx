import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { useLanguage } from "@/lib/language"
import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogPortal = DialogPrimitive.Portal

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-(--backdrop) backdrop-blur-[2px] duration-[140ms] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const { t } = useLanguage()
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        // `duration-*` is meant for the enter and exit animations. Without `transition-none` it also eases every
        // property, so the import dialog would animate its width as it widens into the review.
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid max-h-[calc(100vh-40px)] w-[calc(100%-40px)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-2 overflow-y-auto overscroll-contain rounded-[var(--r-l)] bg-background p-5 shadow-(--shadow-modal) transition-none ease-[var(--ease-out)] data-[state=open]:duration-200 data-[state=closed]:duration-[140ms] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-[.98] data-[state=open]:zoom-in-[.97]",
          // On a phone every dialog is a bottom sheet: full width, 14px top corners, rising solid in 320ms.
          "max-md:inset-x-0 max-md:top-auto max-md:bottom-0 max-md:w-full max-md:max-w-none max-md:max-h-[calc(100dvh-24px)] max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:rounded-t-[14px] max-md:bg-raised max-md:pt-11 max-md:pb-[calc(20px+env(safe-area-inset-bottom))] max-md:data-[state=open]:duration-[320ms] max-md:data-[state=closed]:duration-200 max-md:data-[state=open]:fade-in-100 max-md:data-[state=closed]:fade-out-100 max-md:data-[state=open]:zoom-in-100 max-md:data-[state=closed]:zoom-out-100 max-md:data-[state=open]:slide-in-from-bottom max-md:data-[state=closed]:slide-out-to-bottom",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 grid size-7 place-items-center rounded-md text-muted-foreground transition-[color,background-color,transform] duration-150 hover:bg-accent hover:text-foreground active:scale-[.92] disabled:pointer-events-none max-md:hidden pointer-coarse:size-11">
          <X className="h-4 w-4" />
          <span className="sr-only">{t("关闭", "Close")}</span>
        </DialogPrimitive.Close>
        {/* A tap on the sheet's handle closes it. */}
        <DialogPrimitive.Close className="group absolute left-1/2 top-0 grid h-11 w-20 -translate-x-1/2 place-items-center md:hidden">
          <span className="h-[5px] w-9 rounded-full bg-(--control) shadow-(--shadow-button) transition-transform duration-150 group-active:scale-x-90" />
          <span className="sr-only">{t("关闭", "Close")}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-base font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
}
