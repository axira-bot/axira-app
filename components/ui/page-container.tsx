"use client";

type PageContainerProps = {
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  outerClassName?: string;
};

const SIZE_CLASS: Record<NonNullable<PageContainerProps["size"]>, string> = {
  sm: "app-page-sm",
  md: "app-page-md",
  lg: "app-page-lg",
  xl: "app-page-xl",
};

export function PageContainer({ children, size = "xl", className = "", outerClassName = "" }: PageContainerProps) {
  return (
    <div className={`app-page ${SIZE_CLASS[size]} ${outerClassName}`}>
      <div className={`app-page-content ${className}`}>{children}</div>
    </div>
  );
}
