"use client";

import * as React from "react";
import { useRef } from "react";
import {
  MotionValue,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "motion/react";

import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import Link from "next/link";

const cn = (...args: ClassValue[]) => twMerge(clsx(...args));

export interface AnimatedDockProps {
  className?: string;
  items: DockItemData[];
}

export interface DockItemData {
  Icon: React.ReactNode;
  label: string;
  link?: string;
  onClick?: () => void;
  active?: boolean;
  target?: string;
  rel?: string;
  badge?: boolean | number;
}

export const AnimatedDock = ({ className, items }: AnimatedDockProps) => {
  const mouseX = useMotionValue(Infinity);

  return (
    <motion.div
      onMouseMove={(e) => mouseX.set(e.pageX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      className={cn(
        "mx-auto flex h-16 items-end gap-4 rounded-2xl bg-secondary/50 border border-primary/10 shadow-md px-4 pb-3",
        className,
      )}
    >
      {items.map((item, index) => (
        <DockItem
          key={index}
          mouseX={mouseX}
          active={item.active}
          badge={item.badge}
        >
          {item.link ? (
            <Link
              href={item.link}
              target={item.target}
              rel={item.rel}
              onClick={item.onClick}
              aria-label={item.label}
              className="flex h-full w-full grow items-center justify-center"
            >
              {item.Icon}
            </Link>
          ) : (
            <button
              type="button"
              onClick={item.onClick}
              aria-label={item.label}
              className="flex h-full w-full grow items-center justify-center"
            >
              {item.Icon}
            </button>
          )}
        </DockItem>
      ))}
    </motion.div>
  );
};

interface DockItemProps {
  mouseX: MotionValue<number>;
  children: React.ReactNode;
  active?: boolean;
  badge?: boolean | number;
}

export const DockItem = ({
  mouseX,
  children,
  active = false,
  badge = false,
}: DockItemProps) => {
  const ref = useRef<HTMLDivElement>(null);

  const distance = useTransform(mouseX, (val) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  const widthSync = useTransform(distance, [-150, 0, 150], [40, 80, 40]);
  const width = useSpring(widthSync, {
    mass: 0.1,
    stiffness: 150,
    damping: 12,
  });

  const iconScale = useTransform(width, [40, 80], [1, 1.5]);
  const iconSpring = useSpring(iconScale, {
    mass: 0.1,
    stiffness: 150,
    damping: 12,
  });

  return (
    <motion.div
      ref={ref}
      style={{ width }}
      className={cn(
        "relative flex aspect-square w-10 items-center justify-center rounded-full border",
        active
          ? "border-primary/30 bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground",
      )}
    >
      <motion.div
        style={{ scale: iconSpring }}
        className="flex h-full w-full grow items-center justify-center"
      >
        {children}
      </motion.div>
      {badge ? (
        <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-primary" />
      ) : null}
    </motion.div>
  );
};
