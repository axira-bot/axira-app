"use client";

import { Button } from "@heroui/react";
import { useEffect, useMemo, useState } from "react";

type Column<T extends object> = {
  key: string;
  label: string;
  align?: "start" | "center" | "end";
  render: (item: T) => React.ReactNode;
};

type PaginatedTableProps<T extends object> = {
  rows: T[];
  columns: Column<T>[];
  rowKey: (item: T) => React.Key;
  emptyContent: string;
  pageSize?: number;
  className?: string;
  page?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
};

export function PaginatedTable<T extends object>({
  rows,
  columns,
  rowKey,
  emptyContent,
  pageSize = 10,
  className,
  page: controlledPage,
  total: controlledTotal,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
}: PaginatedTableProps<T>) {
  const isControlled = typeof controlledPage === "number" && typeof controlledTotal === "number" && typeof onPageChange === "function";
  const [uncontrolledPage, setUncontrolledPage] = useState(1);
  const [localPageSize, setLocalPageSize] = useState(pageSize);
  const effectivePageSize = onPageSizeChange ? pageSize : localPageSize;
  const page = isControlled ? controlledPage : uncontrolledPage;
  const totalItems = isControlled ? controlledTotal : rows.length;
  const pages = Math.max(1, Math.ceil(totalItems / effectivePageSize));
  const setPage = isControlled ? onPageChange : setUncontrolledPage;
  const pagedRows = useMemo(() => {
    if (isControlled) return rows;
    const start = (page - 1) * effectivePageSize;
    return rows.slice(start, start + effectivePageSize);
  }, [rows, page, effectivePageSize, isControlled]);

  useEffect(() => {
    if (!onPageSizeChange) setLocalPageSize(pageSize);
  }, [pageSize, onPageSizeChange]);

  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  if (rows.length === 0) {
    return <div className="p-4 text-sm text-default-500">{emptyContent}</div>;
  }

  return (
    <div className={className}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-default-200 bg-default-50 text-xs uppercase tracking-wide text-default-500">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="px-3 py-2">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((item) => (
              <tr key={rowKey(item)} className="border-b border-default-100 last:border-b-0">
                {columns.map((column) => (
                  <td key={column.key} className="px-3 py-2 align-top">
                    <div className={column.align === "end" ? "text-right" : column.align === "center" ? "text-center" : ""}>
                      {column.render(item)}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex w-full flex-col gap-2 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs text-default-500">
          <span>Rows per page</span>
          <select
            value={effectivePageSize}
            onChange={(event) => {
              const nextSize = Number(event.target.value);
              if (onPageSizeChange) onPageSizeChange(nextSize);
              else setLocalPageSize(nextSize);
              setPage(1);
            }}
            className="rounded-md border border-default-200 bg-white px-2 py-1 text-xs text-default-700 outline-none"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <span>
            {(page - 1) * effectivePageSize + 1}-{Math.min(page * effectivePageSize, totalItems)} of {totalItems}
          </span>
        </div>
        {pages > 1 ? (
          <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-default-500">
            Page {page} / {pages}
          </span>
          <Button type="button" size="sm" variant="outline" isDisabled={page <= 1} onPress={() => setPage(Math.max(1, page - 1))}>
            Previous
          </Button>
          <Button type="button" size="sm" variant="outline" isDisabled={page >= pages} onPress={() => setPage(Math.min(pages, page + 1))}>
            Next
          </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
