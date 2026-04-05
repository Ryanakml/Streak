"use client";

import * as React from "react";
import clsx, { type ClassValue } from "clsx";
import Link from "next/link";
import { twMerge } from "tailwind-merge";

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
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-3xl items-stretch border-2 border-black bg-card shadow-[6px_6px_0px_0px_rgba(26,24,20,1)]",
        className,
      )}
    >
      {items.map((item, index) => (
        <DockItem
          key={index}
          active={item.active}
          badge={item.badge}
          label={item.label}
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
              <span className="flex items-center gap-2">
                {item.Icon}
                <span>{item.label}</span>
              </span>
            </Link>
          ) : (
            <button
              type="button"
              onClick={item.onClick}
              aria-label={item.label}
              className="flex h-full w-full grow items-center justify-center"
            >
              <span className="flex items-center gap-2">
                {item.Icon}
                <span>{item.label}</span>
              </span>
            </button>
          )}
        </DockItem>
      ))}
    </div>
  );
};

interface DockItemProps {
  children: React.ReactNode;
  active?: boolean;
  badge?: boolean | number;
  label: string;
}

export const DockItem = ({
  children,
  active = false,
  badge = false,
  label,
}: DockItemProps) => {
  return (
    <div
      className={cn(
        "relative flex min-h-16 flex-1 items-center justify-center border-r-2 border-black last:border-r-0",
        active
          ? "bg-[#DF3B23] text-white"
          : "bg-card text-foreground",
      )}
    >
      <div
        className="flex h-full w-full grow items-center justify-center text-[10px] font-black uppercase tracking-[0.24em]"
      >
        {children}
      </div>
      {badge ? (
        <span
          aria-label={`${label} has unread activity`}
          className="absolute right-2 top-2 h-3 w-3 border border-black bg-black"
        />
      ) : null}
    </div>
  );
};
