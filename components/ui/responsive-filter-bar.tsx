"use client";

type ResponsiveFilterBarProps = {
  children: React.ReactNode;
  className?: string;
};

export function ResponsiveFilterBar({ children, className = "" }: ResponsiveFilterBarProps) {
  return <div className={`responsive-filter-bar ${className}`}>{children}</div>;
}
