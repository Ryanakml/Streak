"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-none border-2 border-black bg-card bg-clip-padding text-xs font-black whitespace-nowrap uppercase tracking-[0.18em] text-foreground shadow-[4px_4px_0px_0px_rgba(26,24,20,1)] transition-[transform,box-shadow,background-color,color] outline-none select-none hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_rgba(26,24,20,1)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-black text-white [a]:hover:bg-black",
        outline:
          "bg-background text-foreground hover:bg-secondary aria-expanded:bg-secondary",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary aria-expanded:bg-secondary",
        ghost:
          "bg-transparent shadow-none hover:bg-secondary hover:translate-x-0 hover:translate-y-0 hover:shadow-none active:translate-x-0 active:translate-y-0 active:shadow-none",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive",
        link: "border-0 bg-transparent px-0 text-[#DF3B23] underline-offset-4 shadow-none hover:translate-x-0 hover:translate-y-0 hover:shadow-none hover:underline active:translate-x-0 active:translate-y-0",
      },
      size: {
        default:
          "min-h-10 px-3 py-2 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "min-h-8 px-2 py-1 text-[10px] [&_svg:not([class*='size-'])]:size-3",
        sm: "min-h-9 px-3 py-1.5 text-[11px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "min-h-12 px-4 py-3 text-sm",
        icon: "size-10 p-0",
        "icon-xs":
          "size-8 p-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-9 p-0",
        "icon-lg": "size-12 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
