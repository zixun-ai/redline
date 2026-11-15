import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { UIEvent } from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Whether something stamped at `at` only just arrived. Entrances key off this instead of mounting,
 * so switching tabs or reloading never replays them.
 */
export const isFresh = (at: number | undefined) => at !== undefined && Date.now() - at < 1000;

/** Marks a scroller once anything has gone out of sight at its top, which draws the line under its panel's tabs. */
export const markScrolled = (e: UIEvent<HTMLElement>) => { e.currentTarget.toggleAttribute("data-scrolled", e.currentTarget.scrollTop > 0); };

/** Scripted scrolling ignores CSS, so it has to check the setting itself. */
export const scrollMotion = (): ScrollBehavior =>
  matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
