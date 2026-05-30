import { useMemo, useRef, useState } from "react";
import type { ColumnDef, DateRange, OrderRow, ShopeeConfig } from "./shopeeApi";
import { fetchOrdersWithEscrow } from "./shopeeApi";

type Page = "orders" | "columns" | "excel";

const STORAGE_KEYS = {
  shopeeConfig: "gntech.shopee.config",
  visibleColumns: "gntech.orders.visibleColumns",
  visibleExcelOrderColumns: "gntech.excel.orderColumns",
  visibleExcelSkuColumns: "gntech.excel.skuColumns",
};

const fallbackColumns: ColumnDef[] = [
  { key: "order_sn", label: "Mã đơn" },
  { key: "order_status", label: "Trạng thái" },
  { key: "create_time", label: "Ngày tạo", type: "date" },
  { key: "buyer_username", label: "Người mua" },
  { key: "total_amount", label: "Tổng đơn", type: "currency", align: "right" },
  { key: "escrow_amount", label: "Escrow", type: "currency", align: "right" },
  {
    key: "commission_fee",
    label: "Hoa hồng",
    type: "currency",
    align: "right",
  },
  {
    key: "service_fee",
    label: "Phí dịch vụ",
    type: "currency",
    align: "right",
  },
];

const defaultVisibleColumns = fallbackColumns.map((column) => column.key);

const defaultConfig: ShopeeConfig = {
  apiBaseUrl: "https://venuscharm-worker.999.vn",
  shopId: "18230319",
};

function todayInputValue(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    if (!value) {
      return fallback;
    }
    const parsed = JSON.parse(value) as Partial<T> & Record<string, unknown>;
    return {
      ...fallback,
      ...parsed,
      apiBaseUrl:
        typeof parsed.apiBaseUrl === "string"
          ? parsed.apiBaseUrl
          : defaultConfig.apiBaseUrl,
    } as T;
  } catch {
    return fallback;
  }
}

function loadVisibleColumns() {
  try {
    const value = localStorage.getItem(STORAGE_KEYS.visibleColumns);
    if (!value) {
      return defaultVisibleColumns;
    }
    const parsed = JSON.parse(value) as string[];
    return parsed.length > 0 ? parsed : defaultVisibleColumns;
  } catch {
    return defaultVisibleColumns;
  }
}

function loadStringList(key: string, fallback: string[]) {
  try {
    const value = localStorage.getItem(key);
    if (!value) {
      return fallback;
    }
    const parsed = JSON.parse(value) as string[];
    return parsed.length > 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function formatDate(value: unknown) {
  if (typeof value !== "number") {
    return "-";
  }
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value * 1000));
}

function formatCurrency(value: unknown, currency = "VND") {
  if (typeof value !== "number") {
    return "-";
  }
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format(value);
}

function formatCell(row: OrderRow, column: ColumnDef) {
  const value = row.values[column.key];

  if (column.type === "date") {
    return formatDate(value);
  }

  if (column.type === "currency") {
    return formatCurrency(value, row.currency);
  }

  if (column.type === "boolean") {
    return typeof value === "boolean" ? (value ? "Có" : "Không") : "-";
  }

  if (typeof value === "number") {
    return new Intl.NumberFormat("vi-VN").format(value);
  }

  return value === undefined || value === null || value === ""
    ? "-"
    : String(value);
}

function isDateRangeValid(range: DateRange) {
  const start = parseDateValue(range.from);
  const end = parseDateValue(range.to);
  if (!start || !end) {
    return false;
  }
  const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  return days >= 1;
}

function parseDateValue(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function App() {
  const [page, setPage] = useState<Page>("orders");
  const [config, setConfig] = useState<ShopeeConfig>(() =>
    loadJson(STORAGE_KEYS.shopeeConfig, defaultConfig),
  );
  const [range, setRange] = useState<DateRange>({
    from: todayInputValue(-13),
    to: todayInputValue(),
  });
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [columns, setColumns] = useState<ColumnDef[]>(fallbackColumns);
  const [visibleColumns, setVisibleColumns] =
    useState<string[]>(loadVisibleColumns);
  const [visibleExcelOrderColumns, setVisibleExcelOrderColumns] = useState<
    string[]
  >(() => loadStringList(STORAGE_KEYS.visibleExcelOrderColumns, defaultExcelOrderColumns));
  const [visibleExcelSkuColumns, setVisibleExcelSkuColumns] = useState<
    string[]
  >(() => loadStringList(STORAGE_KEYS.visibleExcelSkuColumns, defaultExcelSkuColumns));
  const [selectedRow, setSelectedRow] = useState<OrderRow | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const activeColumns = useMemo(
    () => columns.filter((column) => visibleColumns.includes(column.key)),
    [columns, visibleColumns],
  );

  const totals = useMemo(
    () => ({
      orders: rows.length,
      gross: rows.reduce(
        (sum, row) => sum + numberValue(row.values.total_amount),
        0,
      ),
      escrow: rows.reduce(
        (sum, row) => sum + numberValue(row.values.escrow_amount),
        0,
      ),
      fees: rows.reduce(
        (sum, row) =>
          sum +
          numberValue(row.values.commission_fee) +
          numberValue(row.values.service_fee),
        0,
      ),
    }),
    [rows],
  );

  function updateConfig(nextConfig: ShopeeConfig) {
    setConfig(nextConfig);
    localStorage.setItem(STORAGE_KEYS.shopeeConfig, JSON.stringify(nextConfig));
  }

  function updateVisibleColumns(nextColumns: string[]) {
    setVisibleColumns(nextColumns);
    localStorage.setItem(
      STORAGE_KEYS.visibleColumns,
      JSON.stringify(nextColumns),
    );
  }

  function updateVisibleExcelOrderColumns(nextColumns: string[]) {
    setVisibleExcelOrderColumns(nextColumns);
    localStorage.setItem(
      STORAGE_KEYS.visibleExcelOrderColumns,
      JSON.stringify(nextColumns),
    );
  }

  function updateVisibleExcelSkuColumns(nextColumns: string[]) {
    setVisibleExcelSkuColumns(nextColumns);
    localStorage.setItem(
      STORAGE_KEYS.visibleExcelSkuColumns,
      JSON.stringify(nextColumns),
    );
  }

  async function loadOrders() {
    setError("");

    if (!isDateRangeValid(range)) {
      setError("Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc.");
      return;
    }

    setIsLoading(true);
    try {
      const result = await fetchOrdersWithEscrow(config, range);
      setRows(result.rows);
      setColumns(result.columns.length > 0 ? result.columns : fallbackColumns);
      setVisibleColumns((current) => {
        const validKeys = new Set(result.columns.map((column) => column.key));
        const next = current.filter((key) => validKeys.has(key));
        return next.length > 0 ? next : defaultVisibleColumns;
      });
      setSelectedRow(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không tải được dữ liệu Shopee.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function exportOrders() {
    if (rows.length === 0) {
      setError("Chưa có dữ liệu để export.");
      return;
    }

    setError("");
    exportRevenueWorkbook(rows, range, {
      orderColumns: visibleExcelOrderColumns,
      skuColumns: visibleExcelSkuColumns,
    });
  }

  return (
    <main className="min-h-svh bg-[#f6f7f9] text-[#172033]">
      <div className="mx-auto flex min-h-svh max-w-[1440px]">
        <aside className="hidden w-64 border-r border-[#d9dee7] bg-white px-4 py-5 lg:block">
          <div className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7d8797]">
              GNTech
            </p>
            <h1 className="mt-1 text-xl font-semibold text-[#172033]">
              Shopee Accountant
            </h1>
          </div>
          <nav className="space-y-1">
            <NavButton
              active={page === "orders"}
              onClick={() => setPage("orders")}
            >
              Đơn hàng
            </NavButton>
            <NavButton
              active={page === "columns"}
              onClick={() => setPage("columns")}
            >
              Cấu hình bảng
            </NavButton>
            <NavButton
              active={page === "excel"}
              onClick={() => setPage("excel")}
            >
              Cấu hình Excel
            </NavButton>
          </nav>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-[#d9dee7] bg-white px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-[#667085]">
                  Order detail + payment escrow detail qua backend worker
                </p>
                <h2 className="text-2xl font-semibold text-[#172033]">
                  {page === "orders"
                    ? "Đối soát đơn hàng"
                    : page === "columns"
                      ? "Cấu hình cột hiển thị"
                      : "Cấu hình Excel"}
                </h2>
              </div>
              <div className="grid grid-cols-3 gap-2 lg:hidden">
                <NavButton
                  active={page === "orders"}
                  onClick={() => setPage("orders")}
                >
                  Đơn hàng
                </NavButton>
                <NavButton
                  active={page === "columns"}
                  onClick={() => setPage("columns")}
                >
                  Cấu hình
                </NavButton>
                <NavButton
                  active={page === "excel"}
                  onClick={() => setPage("excel")}
                >
                  Excel
                </NavButton>
              </div>
            </div>
          </header>

          {page === "orders" ? (
            <OrdersPage
              activeColumns={activeColumns}
              config={config}
              error={error}
              isLoading={isLoading}
              onConfigChange={updateConfig}
              onExportOrders={exportOrders}
              onLoadOrders={loadOrders}
              onRangeChange={setRange}
              onSelectRow={setSelectedRow}
              range={range}
              rows={rows}
              totals={totals}
            />
          ) : page === "columns" ? (
            <ColumnsPage
              columns={columns}
              visibleColumns={visibleColumns}
              onVisibleColumnsChange={updateVisibleColumns}
            />
          ) : (
            <ExcelConfigPage
              orderColumns={visibleExcelOrderColumns}
              skuColumns={visibleExcelSkuColumns}
              onOrderColumnsChange={updateVisibleExcelOrderColumns}
              onSkuColumnsChange={updateVisibleExcelSkuColumns}
            />
          )}
        </section>
      </div>

      {selectedRow ? (
        <OrderDetail row={selectedRow} onClose={() => setSelectedRow(null)} />
      ) : null}
    </main>
  );
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : 0;
}

function NavButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`w-full rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
        active
          ? "bg-[#e9f1ff] text-[#155eef]"
          : "text-[#465468] hover:bg-[#f0f3f7]"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function OrdersPage({
  activeColumns,
  config,
  error,
  isLoading,
  onConfigChange,
  onExportOrders,
  onLoadOrders,
  onRangeChange,
  onSelectRow,
  range,
  rows,
  totals,
}: {
  activeColumns: ColumnDef[];
  config: ShopeeConfig;
  error: string;
  isLoading: boolean;
  onConfigChange: (config: ShopeeConfig) => void;
  onExportOrders: () => void;
  onLoadOrders: () => void;
  onRangeChange: (range: DateRange) => void;
  onSelectRow: (row: OrderRow) => void;
  range: DateRange;
  rows: OrderRow[];
  totals: { orders: number; gross: number; escrow: number; fees: number };
}) {
  return (
    <div className="flex-1 space-y-5 overflow-auto p-4 sm:p-6">
      <section className="rounded-lg border border-[#d9dee7] bg-white p-4">
        <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
          <TextInput
            label="Backend API URL"
            value={config.apiBaseUrl}
            onChange={(value) =>
              onConfigChange({ ...config, apiBaseUrl: value })
            }
          />
          <TextInput
            label="Shop ID"
            value={config.shopId}
            onChange={(value) => onConfigChange({ ...config, shopId: value })}
          />
        </div>
      </section>

      <section className="rounded-lg border border-[#d9dee7] bg-white p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,520px)_auto_auto] lg:items-end">
          <div className="space-y-3">
            <DateInput
              label="Ngày bắt đầu"
              value={range.from}
              onChange={(value) => onRangeChange({ ...range, from: value })}
            />
            <DateInput
              label="Ngày kết thúc"
              value={range.to}
              onChange={(value) => onRangeChange({ ...range, to: value })}
            />
          </div>
          <button
            type="button"
            className="h-10 rounded-md bg-[#155eef] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#004eeb] disabled:cursor-not-allowed disabled:bg-[#9db7f9]"
            disabled={isLoading}
            onClick={onLoadOrders}
          >
            {isLoading ? "Đang tải..." : "Tải dữ liệu"}
          </button>
          <button
            type="button"
            className="h-10 rounded-md border border-[#c8d0dc] bg-white px-4 text-sm font-semibold text-[#344054] transition-colors hover:bg-[#f6f7f9] disabled:cursor-not-allowed disabled:bg-[#f2f4f7] disabled:text-[#98a2b3]"
            disabled={isLoading || rows.length === 0}
            onClick={onExportOrders}
          >
            Export XLSX
          </button>
        </div>
        <p className="mt-2 text-sm text-[#667085]">
          Có thể chọn khoảng dài hơn 14 ngày, hệ thống sẽ tự chia nhỏ khi gọi Shopee.
        </p>
        {error ? (
          <div className="mt-3 rounded-md border border-[#f5b8b8] bg-[#fff1f1] px-3 py-2 text-sm text-[#b42318]">
            {error}
          </div>
        ) : null}
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <Metric label="Số đơn" value={String(totals.orders)} />
        <Metric label="Tổng giá trị đơn" value={formatCurrency(totals.gross)} />
        <Metric label="Tổng escrow" value={formatCurrency(totals.escrow)} />
        <Metric label="Tổng phí" value={formatCurrency(totals.fees)} />
      </section>

      <DataTable
        columns={activeColumns}
        rows={rows}
        onSelectRow={onSelectRow}
      />
    </div>
  );
}

function ColumnsPage({
  columns,
  visibleColumns,
  onVisibleColumnsChange,
}: {
  columns: ColumnDef[];
  visibleColumns: string[];
  onVisibleColumnsChange: (columns: string[]) => void;
}) {
  const visibleSet = new Set(visibleColumns);

  function toggleColumn(key: string) {
    if (visibleSet.has(key)) {
      const next = visibleColumns.filter((columnKey) => columnKey !== key);
      onVisibleColumnsChange(next.length > 0 ? next : visibleColumns);
      return;
    }
    onVisibleColumnsChange([...visibleColumns, key]);
  }

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6">
      <section className="max-w-5xl rounded-lg border border-[#d9dee7] bg-white p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-[#172033]">
              Cột trong bảng đơn hàng
            </h3>
            <p className="text-sm text-[#667085]">
              Tick những field cần xem trong data table.
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-[#c8d0dc] px-3 py-2 text-sm font-medium text-[#344054] hover:bg-[#f6f7f9]"
            onClick={() => onVisibleColumnsChange(defaultVisibleColumns)}
          >
            Mặc định
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {columns.map((column) => (
            <label
              key={column.key}
              className="flex cursor-pointer items-center justify-between rounded-md border border-[#e4e7ec] px-3 py-2 hover:bg-[#f8fafc]"
            >
              <span className="min-w-0 pr-3">
                <span className="block truncate text-sm font-medium text-[#172033]">
                  {column.label}
                </span>
                <span className="block truncate font-mono text-xs text-[#667085]">
                  {column.key}
                </span>
              </span>
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-[#155eef]"
                checked={visibleSet.has(column.key)}
                onChange={() => toggleColumn(column.key)}
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

function ExcelConfigPage({
  orderColumns,
  skuColumns,
  onOrderColumnsChange,
  onSkuColumnsChange,
}: {
  orderColumns: string[];
  skuColumns: string[];
  onOrderColumnsChange: (columns: string[]) => void;
  onSkuColumnsChange: (columns: string[]) => void;
}) {
  return (
    <div className="flex-1 space-y-5 overflow-auto p-4 sm:p-6">
      <ExcelColumnPicker
        title="Dòng Order"
        description="Các cột xuất cho dòng tổng quan đơn hàng."
        selectedColumns={orderColumns}
        defaultColumns={defaultExcelOrderColumns}
        onSelectedColumnsChange={onOrderColumnsChange}
      />
      <ExcelColumnPicker
        title="Dòng Sku"
        description="Các cột xuất cho từng sản phẩm/phân loại trong đơn."
        selectedColumns={skuColumns}
        defaultColumns={defaultExcelSkuColumns}
        onSelectedColumnsChange={onSkuColumnsChange}
      />
    </div>
  );
}

function ExcelColumnPicker({
  defaultColumns,
  description,
  onSelectedColumnsChange,
  selectedColumns,
  title,
}: {
  defaultColumns: string[];
  description: string;
  onSelectedColumnsChange: (columns: string[]) => void;
  selectedColumns: string[];
  title: string;
}) {
  const selectedSet = new Set(selectedColumns);

  function toggleColumn(key: string) {
    if (selectedSet.has(key)) {
      const next = selectedColumns.filter((columnKey) => columnKey !== key);
      onSelectedColumnsChange(next.length > 0 ? next : selectedColumns);
      return;
    }

    const next = excelColumns
      .map((column) => column.key)
      .filter((columnKey) => selectedSet.has(columnKey) || columnKey === key);
    onSelectedColumnsChange(next);
  }

  return (
    <section className="rounded-lg border border-[#d9dee7] bg-white p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-[#172033]">{title}</h3>
          <p className="text-sm text-[#667085]">{description}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md border border-[#c8d0dc] px-3 py-2 text-sm font-medium text-[#344054] hover:bg-[#f6f7f9]"
            onClick={() => onSelectedColumnsChange(excelColumns.map((column) => column.key))}
          >
            Chọn tất cả
          </button>
          <button
            type="button"
            className="rounded-md border border-[#c8d0dc] px-3 py-2 text-sm font-medium text-[#344054] hover:bg-[#f6f7f9]"
            onClick={() => onSelectedColumnsChange(defaultColumns)}
          >
            Mặc định
          </button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {excelColumns.map((column) => (
          <label
            key={column.key}
            className="flex cursor-pointer items-center justify-between rounded-md border border-[#e4e7ec] px-3 py-2 hover:bg-[#f8fafc]"
          >
            <span className="min-w-0 pr-3">
              <span className="block truncate text-sm font-medium text-[#172033]">
                {column.label}
              </span>
              <span className="block truncate font-mono text-xs text-[#667085]">
                {column.key}
              </span>
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-[#155eef]"
              checked={selectedSet.has(column.key)}
              onChange={() => toggleColumn(column.key)}
            />
          </label>
        ))}
      </div>
    </section>
  );
}

function TextInput({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#667085]">
        {label}
      </span>
      <input
        className="h-10 w-full rounded-md border border-[#c8d0dc] bg-white px-3 text-sm text-[#172033] outline-none focus:border-[#155eef] focus:ring-2 focus:ring-[#d1e0ff]"
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function DateInput({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const parts = parseDateParts(value);
  const datePickerRef = useRef<HTMLInputElement>(null);
  const monthInputRef = useRef<HTMLInputElement>(null);
  const yearInputRef = useRef<HTMLInputElement>(null);

  function updatePart(part: "day" | "month" | "year", nextValue: string, pad = false) {
    const cleanedValue = numericInput(nextValue, part === "year" ? 4 : 2);
    const normalizedValue =
      pad && part !== "year" && cleanedValue.length === 1
        ? cleanedValue.padStart(2, "0")
        : cleanedValue;
    const nextParts = {
      ...parts,
      [part]: normalizedValue,
    };
    onChange(`${nextParts.year}-${nextParts.month}-${nextParts.day}`);
  }

  function openDatePicker() {
    const picker = datePickerRef.current;
    if (!picker) {
      return;
    }

    if (typeof picker.showPicker === "function") {
      picker.showPicker();
      return;
    }

    picker.focus();
    picker.click();
  }

  return (
    <div>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#667085]">
        {label}
      </span>
      <div className="relative grid grid-cols-[72px_72px_96px_40px] gap-2">
        <DatePartInput
          label="Ngày"
          maxLength={2}
          onComplete={() => focusAndSelect(monthInputRef.current)}
          onChange={(nextValue) => updatePart("day", nextValue)}
          onBlur={(nextValue) => updatePart("day", nextValue, true)}
          value={parts.day}
        />
        <DatePartInput
          inputRef={monthInputRef}
          label="Tháng"
          maxLength={2}
          onComplete={() => focusAndSelect(yearInputRef.current)}
          onChange={(nextValue) => updatePart("month", nextValue)}
          onBlur={(nextValue) => updatePart("month", nextValue, true)}
          value={parts.month}
        />
        <DatePartInput
          inputRef={yearInputRef}
          label="Năm"
          maxLength={4}
          onChange={(nextValue) => updatePart("year", nextValue)}
          onBlur={(nextValue) => updatePart("year", nextValue)}
          value={parts.year}
        />
        <input
          ref={datePickerRef}
          aria-hidden="true"
          className="pointer-events-none absolute h-0 w-0 opacity-0"
          tabIndex={-1}
          type="date"
          value={parseDateValue(value) ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          aria-label={`Chọn ${label.toLowerCase()} từ lịch`}
          className="flex h-10 w-10 items-center justify-center rounded-md border border-[#c8d0dc] bg-white text-[#465468] transition-colors hover:bg-[#f6f7f9] focus:border-[#155eef] focus:outline-none focus:ring-2 focus:ring-[#d1e0ff]"
          onClick={openDatePicker}
        >
          <CalendarIcon />
        </button>
      </div>
    </div>
  );
}

function DatePartInput({
  inputRef,
  label,
  maxLength,
  onComplete,
  onChange,
  onBlur,
  value,
}: {
  inputRef?: React.Ref<HTMLInputElement>;
  label: string;
  maxLength: number;
  onComplete?: () => void;
  onChange: (value: string) => void;
  onBlur: (value: string) => void;
  value: string;
}) {
  function handleChange(nextValue: string) {
    const cleanedValue = numericInput(nextValue, maxLength);
    onChange(cleanedValue);
    if (cleanedValue.length === maxLength) {
      onComplete?.();
    }
  }

  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <input
        aria-label={label}
        className="h-10 w-full rounded-md border border-[#c8d0dc] bg-white px-3 text-center text-sm text-[#172033] outline-none focus:border-[#155eef] focus:ring-2 focus:ring-[#d1e0ff]"
        inputMode="numeric"
        maxLength={maxLength}
        placeholder={label}
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onBlur={(event) => onBlur(event.target.value)}
      />
    </label>
  );
}

function focusAndSelect(input: HTMLInputElement | null) {
  if (!input) {
    return;
  }

  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <path d="M3 10h18" />
      <rect height="18" rx="2" width="18" x="3" y="4" />
    </svg>
  );
}

function parseDateParts(value: string) {
  const [year = "", month = "", day = ""] = value.split("-");
  return { day, month, year };
}

function numericInput(value: string, maxLength: number) {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#d9dee7] bg-white p-4">
      <p className="text-sm text-[#667085]">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold text-[#172033]">
        {value}
      </p>
    </div>
  );
}

function DataTable({
  columns,
  onSelectRow,
  rows,
}: {
  columns: ColumnDef[];
  onSelectRow: (row: OrderRow) => void;
  rows: OrderRow[];
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#d9dee7] bg-white">
      <div className="flex items-center justify-between border-b border-[#d9dee7] px-4 py-3">
        <h3 className="text-base font-semibold text-[#172033]">Data table</h3>
        <span className="text-sm text-[#667085]">{rows.length} đơn</span>
      </div>
      <div className="overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 bg-[#f8fafc]">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`whitespace-nowrap border-b border-[#d9dee7] px-4 py-3 font-semibold text-[#465468] ${
                    column.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {column.label}
                </th>
              ))}
              <th className="border-b border-[#d9dee7] px-4 py-3 text-right font-semibold text-[#465468]">
                Chi tiết
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  className="px-4 py-12 text-center text-[#667085]"
                  colSpan={columns.length + 1}
                >
                  Chưa có dữ liệu. Nhập Backend API URL, Shop ID và chọn khoảng
                  ngày để tải đơn.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.order_sn} className="hover:bg-[#f8fafc]">
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`max-w-[280px] truncate whitespace-nowrap border-b border-[#eef1f5] px-4 py-3 text-[#172033] ${
                        column.align === "right" ? "text-right font-medium" : ""
                      }`}
                      title={String(row.values[column.key] ?? "")}
                    >
                      {formatCell(row, column)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap border-b border-[#eef1f5] px-4 py-3 text-right">
                    <button
                      type="button"
                      className="rounded-md border border-[#c8d0dc] px-3 py-1.5 text-sm font-medium text-[#344054] hover:bg-[#f0f3f7]"
                      onClick={() => onSelectRow(row)}
                    >
                      Xem JSON
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OrderDetail({ onClose, row }: { onClose: () => void; row: OrderRow }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <aside className="h-full w-full max-w-5xl overflow-auto bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-[#d9dee7] bg-white px-5 py-4">
          <div>
            <p className="text-sm text-[#667085]">Chi tiết đơn và escrow</p>
            <h3 className="text-lg font-semibold text-[#172033]">
              {row.order_sn}
            </h3>
          </div>
          <button
            type="button"
            className="rounded-md border border-[#c8d0dc] px-3 py-2 text-sm font-medium text-[#344054] hover:bg-[#f0f3f7]"
            onClick={onClose}
          >
            Đóng
          </button>
        </div>
        <div className="grid gap-4 p-5">
          <OrderItemsTable row={row} />
          <JsonBlock title="Order detail" data={row.raw_order} />
          <JsonBlock title="Escrow detail" data={row.raw_escrow || {}} />
        </div>
      </aside>
    </div>
  );
}

function OrderItemsTable({ row }: { row: OrderRow }) {
  const items = asArray(row.raw_order.item_list).map(asRecord);

  return (
    <section className="overflow-hidden rounded-lg border border-[#d9dee7]">
      <div className="flex items-center justify-between border-b border-[#d9dee7] bg-[#f8fafc] px-4 py-3">
        <h4 className="text-sm font-semibold text-[#344054]">Sản phẩm trong đơn</h4>
        <span className="text-sm text-[#667085]">{items.length} dòng</span>
      </div>
      <div className="overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="bg-white">
            <tr>
              <th className="whitespace-nowrap border-b border-[#d9dee7] px-4 py-3 font-semibold text-[#465468]">
                Sản phẩm
              </th>
              <th className="whitespace-nowrap border-b border-[#d9dee7] px-4 py-3 font-semibold text-[#465468]">
                SKU
              </th>
              <th className="whitespace-nowrap border-b border-[#d9dee7] px-4 py-3 font-semibold text-[#465468]">
                Phân loại
              </th>
              <th className="whitespace-nowrap border-b border-[#d9dee7] px-4 py-3 font-semibold text-[#465468]">
                SKU phân loại
              </th>
              <th className="whitespace-nowrap border-b border-[#d9dee7] px-4 py-3 text-right font-semibold text-[#465468]">
                SL
              </th>
              <th className="whitespace-nowrap border-b border-[#d9dee7] px-4 py-3 text-right font-semibold text-[#465468]">
                Giá gốc
              </th>
              <th className="whitespace-nowrap border-b border-[#d9dee7] px-4 py-3 text-right font-semibold text-[#465468]">
                Giá bán
              </th>
              <th className="whitespace-nowrap border-b border-[#d9dee7] px-4 py-3 text-right font-semibold text-[#465468]">
                Tạm tính
              </th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-center text-[#667085]" colSpan={8}>
                  Không có item_list trong order detail.
                </td>
              </tr>
            ) : (
              items.map((item, index) => {
                const quantity = asNumber(item.model_quantity_purchased) ?? 0;
                const originalPrice = asNumber(item.model_original_price);
                const sellingPrice =
                  asNumber(item.model_discounted_price) ?? asNumber(item.model_original_price);
                const lineTotal =
                  typeof sellingPrice === "number" && quantity > 0
                    ? sellingPrice * quantity
                    : undefined;

                return (
                  <tr key={`${asString(item.item_id) || index}-${asString(item.model_id) || ""}`}>
                    <td className="max-w-[360px] border-b border-[#eef1f5] px-4 py-3 text-[#172033]">
                      <div className="line-clamp-2">{asString(item.item_name) || "-"}</div>
                    </td>
                    <td className="whitespace-nowrap border-b border-[#eef1f5] px-4 py-3 text-[#172033]">
                      {asString(item.item_sku) || "-"}
                    </td>
                    <td className="max-w-[220px] truncate whitespace-nowrap border-b border-[#eef1f5] px-4 py-3 text-[#172033]">
                      {asString(item.model_name) || "-"}
                    </td>
                    <td className="whitespace-nowrap border-b border-[#eef1f5] px-4 py-3 text-[#172033]">
                      {asString(item.model_sku) || "-"}
                    </td>
                    <td className="whitespace-nowrap border-b border-[#eef1f5] px-4 py-3 text-right font-medium text-[#172033]">
                      {quantity || "-"}
                    </td>
                    <td className="whitespace-nowrap border-b border-[#eef1f5] px-4 py-3 text-right text-[#172033]">
                      {formatCurrency(originalPrice, row.currency)}
                    </td>
                    <td className="whitespace-nowrap border-b border-[#eef1f5] px-4 py-3 text-right text-[#172033]">
                      {formatCurrency(sellingPrice, row.currency)}
                    </td>
                    <td className="whitespace-nowrap border-b border-[#eef1f5] px-4 py-3 text-right font-medium text-[#172033]">
                      {formatCurrency(lineTotal, row.currency)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function asNumber(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

type ExportCell = string | number | boolean | null | undefined;
type RevenueExportRow = {
  rowType: "Order" | "Sku";
  values: Record<string, ExportCell>;
};

const excelColumns = [
  { key: "transaction_id", label: "Mã giao dịch" },
  { key: "row_type", label: "Đơn hàng / Sản phẩm" },
  { key: "order_sn", label: "Mã đơn hàng" },
  { key: "order_type", label: "Loại đơn hàng" },
  { key: "return_request_sn", label: "Mã yêu cầu hoàn tiền" },
  { key: "tax_registration_code", label: "Mã Số Thuế" },
  { key: "item_id", label: "Mã sản phẩm" },
  { key: "item_name", label: "Tên sản phẩm" },
  { key: "model_name", label: "Phân loại" },
  { key: "item_sku", label: "SKU" },
  { key: "model_sku", label: "SKU Phân loại" },
  { key: "quantity", label: "Số lượng" },
  { key: "product_price", label: "Đơn giá gốc" },
  { key: "discounted_product_price", label: "Đơn giá sau giảm" },
  { key: "shopee_product_subsidy", label: "Sản phẩm được trợ giá từ Shopee" },
  { key: "is_bestseller", label: "Sản Phẩm Bán Chạy" },
  { key: "create_time", label: "Ngày đặt hàng" },
  { key: "pay_time", label: "Ngày hoàn thành thanh toán" },
  { key: "payment_method", label: "Phương thức thanh toán" },
  { key: "buyer_payment_method", label: "Phương thức thanh toán của Người mua" },
  { key: "buyer_payment_method_details", label: "Buyer Payment Method Details_1" },
  { key: "instalment_plan", label: "Installment Plan (if applicable)" },
  { key: "escrow_amount", label: "Tổng tiền đã thanh toán" },
  { key: "buyer_total_amount", label: "Amount Paid By Buyer" },
  { key: "refund_amount", label: "Số tiền hoàn lại" },
  { key: "lost_compensation", label: "Đền bù đơn mất hàng" },
  { key: "trade_in_bonus_by_seller", label: "Trade-in Bonus by Seller" },
  { key: "seller_voucher", label: "Mã ưu đãi do Người Bán chịu" },
  { key: "seller_cofunded_voucher", label: "Mã ưu đãi Đồng Tài Trợ do Người Bán chịu" },
  { key: "seller_coin_cash_back", label: "Mã hoàn xu do Người Bán chịu" },
  { key: "seller_cofunded_coin_cash_back", label: "Mã hoàn xu Đồng Tài Trợ do Người Bán chịu" },
  { key: "voucher_code", label: "Mã voucher" },
  { key: "coins", label: "Shopee xu" },
  { key: "shopee_voucher", label: "Shopee voucher" },
  { key: "bank_credit_card_promotion", label: "Ngân hàng khuyến mãi thanh toán trên Thẻ Tín Dụng" },
  { key: "shopee_credit_card_promotion", label: "Shopee khuyến mãi thanh toán trên Thẻ Tín Dụng" },
  { key: "commission_fee", label: "Phí cố định" },
  { key: "service_fee", label: "Phí Dịch Vụ" },
  { key: "seller_transaction_fee", label: "Phí xử lý giao dịch" },
  { key: "transaction_fee_rate", label: "Transaction Fee Rate (%)" },
  { key: "affiliate_commission_fee", label: "Phí hoa hồng Tiếp thị liên kết" },
  { key: "piship_service_fee", label: "Phí dịch vụ PiShip" },
  { key: "display_service_fee", label: "Phí dịch vụ hiển thị NTTD (từ doanh thu đơn hàng)" },
  { key: "vat_tax", label: "Thuế GTGT" },
  { key: "pit_tax", label: "Thuế TNCN" },
  { key: "buyer_paid_shipping_fee", label: "Phí vận chuyển Người mua trả" },
  { key: "final_shipping_fee", label: "Phí vận chuyển thực tế" },
  { key: "shopee_shipping_rebate", label: "Phí vận chuyển được trợ giá từ Shopee" },
  { key: "seller_shipping_discount", label: "Phí vận chuyển - Người bán hỗ trợ" },
  { key: "reverse_shipping_fee", label: "Phí vận chuyển trả hàng (đơn Trả hàng/hoàn tiền)" },
  { key: "piship_shipping_refund", label: "Phí vận chuyển được hoàn bởi PiShip" },
  { key: "failed_delivery_return_shipping_fee", label: "Phí vận chuyển trả hàng (đơn giao không thành công)" },
  { key: "shipping_carrier", label: "Đơn vị vận chuyển" },
  { key: "courier_name", label: "Courier Name" },
  { key: "buyer_installation_fee", label: "Phí lắp đặt người mua trả" },
  { key: "actual_installation_fee", label: "Phí lắp đặt thực tế" },
  { key: "buyer_username", label: "Người Mua" },
];
const excelColumnKeys = excelColumns.map((column) => column.key);
const defaultExcelOrderColumns = excelColumnKeys.filter(
  (key) =>
    ![
      "item_id",
      "item_name",
      "model_name",
      "item_sku",
      "model_sku",
      "quantity",
    ].includes(key),
);
const defaultExcelSkuColumns = excelColumnKeys;

function mergeColumnKeys(orderColumns: string[], skuColumns: string[]) {
  return excelColumnKeys.filter(
    (key) => orderColumns.includes(key) || skuColumns.includes(key),
  );
}

function exportRevenueWorkbook(
  rows: OrderRow[],
  range: DateRange,
  config: { orderColumns: string[]; skuColumns: string[] },
) {
  const exportRows = buildRevenueExportRows(rows);
  const selectedKeys = mergeColumnKeys(config.orderColumns, config.skuColumns);
  const selectedColumns = excelColumns.filter((column) => selectedKeys.includes(column.key));
  const workbookRows: ExportCell[][] = [
    selectedColumns.map((column) => column.label),
    ...exportRows.map((row) => {
      const allowedKeys = row.rowType === "Sku" ? config.skuColumns : config.orderColumns;
      return selectedColumns.map((column) =>
        allowedKeys.includes(column.key) ? row.values[column.key] : "",
      );
    }),
  ];
  const workbook = createXlsxWorkbook("Doanh thu", workbookRows);
  const blob = new Blob([workbook], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Doanh-thu-${range.from}_${range.to}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildRevenueExportRows(rows: OrderRow[]) {
  let transactionIndex = 1;
  const output: RevenueExportRow[] = [];

  rows.forEach((row) => {
    const order = row.raw_order;
    const escrow = row.raw_escrow || {};
    const income = asRecord(escrow.order_income);
    const buyerPayment = asRecord(escrow.buyer_payment_info);
    const packageList = asArray(order.package_list).map(asRecord);
    const firstPackage = packageList[0] ?? {};
    const orderItems = asArray(order.item_list).map(asRecord);
    const incomeItems = asArray(income.items).map(asRecord);
    const orderSn = asString(order.order_sn) || row.order_sn;
    const itemRows = orderItems.length > 0 ? orderItems : incomeItems;

    output.push(
      revenueRow({
        index: transactionIndex++,
        rowType: "Order",
        order,
        income,
        buyerPayment,
        firstPackage,
        orderSn,
      }),
    );

    itemRows.forEach((item) => {
      const incomeItem = findIncomeItem(incomeItems, item);
      output.push(
        revenueRow({
          index: transactionIndex++,
          rowType: "Sku",
          order,
          income,
          buyerPayment,
          firstPackage,
          orderSn,
          item,
          incomeItem,
        }),
      );
    });
  });

  return output;
}

function revenueRow({
  index,
  rowType,
  order,
  income,
  buyerPayment,
  firstPackage,
  orderSn,
  item,
  incomeItem,
}: {
  index: number;
  rowType: "Order" | "Sku";
  order: Record<string, unknown>;
  income: Record<string, unknown>;
  buyerPayment: Record<string, unknown>;
  firstPackage: Record<string, unknown>;
  orderSn: string;
  item?: Record<string, unknown>;
  incomeItem?: Record<string, unknown>;
}): RevenueExportRow {
  const isSku = rowType === "Sku";
  const source = incomeItem && Object.keys(incomeItem).length > 0 ? incomeItem : income;
  const quantity = item ? asNumber(item.model_quantity_purchased) : undefined;
  const orderItemOriginalPrice = item ? asNumber(item.model_original_price) : undefined;
  const orderItemDiscountedPrice = item ? asNumber(item.model_discounted_price) : undefined;
  const incomeItemOriginalPrice = asNumber(valueFrom(source, "original_price", "original_price_pri"));
  const incomeItemDiscountedPrice = asNumber(valueFrom(source, "discounted_price", "selling_price"));
  const incomeItemSellerDiscount = asNumber(valueFrom(source, "seller_discount"));
  const incomeItemPriceAfterSellerDiscount =
    typeof incomeItemOriginalPrice === "number" && typeof incomeItemSellerDiscount === "number"
      ? incomeItemOriginalPrice - incomeItemSellerDiscount
      : undefined;
  const itemOriginalPrice = incomeItemOriginalPrice ?? orderItemOriginalPrice;
  const itemDiscountedPrice =
    incomeItemDiscountedPrice ?? incomeItemPriceAfterSellerDiscount ?? orderItemDiscountedPrice;
  const orderOnly = (...keys: string[]) => (isSku ? "" : valueFrom(income, ...keys));
  const skuOnly = (...keys: string[]) => (isSku ? valueFrom(source, ...keys) : valueFrom(income, ...keys));

  return {
    rowType,
    values: {
      transaction_id: index,
      row_type: rowType,
      order_sn: orderSn,
      order_type: "\u0110\u01a1n th\u01b0\u1eddng",
      return_request_sn: "",
      tax_registration_code: valueFrom(income, "tax_registration_code"),
      item_id: item ? valueFrom(item, "item_id") : "-",
      item_name: item ? valueFrom(item, "item_name") : "-",
      model_name: item ? valueFrom(item, "model_name") : "-",
      item_sku: item ? valueFrom(item, "item_sku") : "-",
      model_sku: item ? valueFrom(item, "model_sku") : "-",
      quantity: item ? quantity : "-",
      product_price: item ? itemOriginalPrice : valueFrom(income, "order_original_price", "original_price"),
      discounted_product_price: item
        ? itemDiscountedPrice
        : valueFrom(income, "order_discounted_price", "order_selling_price"),
      shopee_product_subsidy: skuOnly("shopee_discount"),
      is_bestseller: "NO",
      create_time: excelDate(order.create_time),
      pay_time: excelDate(order.pay_time),
      payment_method: valueFrom(order, "payment_method"),
      buyer_payment_method: orderOnly("buyer_payment_method", "payment_method"),
      buyer_payment_method_details: isSku ? "" : valueFrom(buyerPayment, "buyer_payment_method"),
      instalment_plan: orderOnly("instalment_plan"),
      escrow_amount: orderOnly("escrow_amount"),
      buyer_total_amount: orderOnly("buyer_total_amount", "buyer_total_amount_pri"),
      refund_amount: orderOnly("seller_return_refund"),
      lost_compensation: orderOnly("seller_lost_compensation"),
      trade_in_bonus_by_seller: orderOnly("trade_in_bonus_by_seller"),
      seller_voucher: skuOnly("discount_from_voucher_seller", "voucher_from_seller"),
      seller_cofunded_voucher: "",
      seller_coin_cash_back: skuOnly("discount_from_coin", "seller_coin_cash_back"),
      seller_cofunded_coin_cash_back: "",
      voucher_code: isSku ? "" : voucherCodes(income),
      coins: skuOnly("discount_from_coin", "coins"),
      shopee_voucher: skuOnly("discount_from_voucher_shopee", "voucher_from_shopee"),
      bank_credit_card_promotion: orderOnly("credit_card_promotion"),
      shopee_credit_card_promotion: orderOnly("payment_promotion"),
      commission_fee: orderOnly("commission_fee", "net_commission_fee"),
      service_fee: orderOnly("service_fee", "net_service_fee"),
      seller_transaction_fee: orderOnly("seller_transaction_fee"),
      transaction_fee_rate: "",
      affiliate_commission_fee: skuOnly("ams_commission_fee", "order_ams_commission_fee"),
      piship_service_fee: orderOnly("fbs_fee"),
      display_service_fee: orderOnly("ads_escrow_top_up_fee_or_technical_support_fee"),
      vat_tax: orderOnly("withholding_vat_tax", "final_product_vat_tax"),
      pit_tax: orderOnly("withholding_pit_tax"),
      buyer_paid_shipping_fee: orderOnly("buyer_paid_shipping_fee"),
      final_shipping_fee: orderOnly("final_shipping_fee", "actual_shipping_fee"),
      shopee_shipping_rebate: orderOnly("shopee_shipping_rebate"),
      seller_shipping_discount: orderOnly("seller_shipping_discount"),
      reverse_shipping_fee: orderOnly("reverse_shipping_fee"),
      piship_shipping_refund: orderOnly("final_return_to_seller_shipping_fee"),
      failed_delivery_return_shipping_fee: orderOnly("reverse_shipping_fee_sst"),
      shipping_carrier: valueFrom(order, "shipping_carrier"),
      courier_name: valueFrom(firstPackage, "shipping_carrier"),
      buyer_installation_fee: isSku ? "" : valueFrom(buyerPayment, "buyer_paid_packaging_fee"),
      actual_installation_fee: orderOnly("actual_shipping_fee"),
      buyer_username: valueFrom(order, "buyer_username"),
    },
  };
}

function findIncomeItem(items: Record<string, unknown>[], item: Record<string, unknown>) {
  const itemId = String(item.item_id ?? "");
  const modelId = String(item.model_id ?? "");
  return (
    items.find(
      (candidate) =>
        String(candidate.item_id ?? "") === itemId &&
        (!modelId || String(candidate.model_id ?? "") === modelId),
    ) || {}
  );
}

function valueFrom(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") {
      return value as ExportCell;
    }
  }
  return "";
}

function voucherCodes(income: Record<string, unknown>) {
  const codes = asArray(income.seller_voucher_code)
    .map((value) => String(value))
    .filter(Boolean);
  return codes.join(", ");
}

function excelDate(value: unknown) {
  if (typeof value !== "number" || value <= 0) {
    return "";
  }
  return new Date(value * 1000).toISOString().slice(0, 10);
}

function createXlsxWorkbook(sheetName: string, rows: ExportCell[][]) {
  const files = new Map<string, Uint8Array>();
  const sheetXml = buildWorksheetXml(rows);

  files.set("[Content_Types].xml", encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`));
  files.set("_rels/.rels", encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`));
  files.set("xl/_rels/workbook.xml.rels", encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`));
  files.set("xl/workbook.xml", encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`));
  files.set("xl/styles.xml", encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEE4D2D"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`));
  files.set("xl/worksheets/sheet1.xml", encodeXml(sheetXml));
  files.set("docProps/core.xml", encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>GNTech Shopee Accountant</dc:creator>
  <cp:lastModifiedBy>GNTech Shopee Accountant</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`));
  files.set("docProps/app.xml", encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>GNTech Shopee Accountant</Application>
</Properties>`));

  return buildZip(files);
}

function buildWorksheetXml(rows: ExportCell[][]) {
  const colCount = Math.max(...rows.map((row) => row.length), 1);
  const colXml = Array.from({ length: colCount }, (_, index) => {
    const width = index === 6 ? 48 : index === 7 ? 22 : index >= 16 ? 18 : 16;
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join("");
  const rowXml = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, colIndex) => worksheetCellXml(rowIndex + 1, colIndex + 1, cell, rowIndex === 0))
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${colXml}</cols>
  <sheetData>${rowXml}</sheetData>
  <autoFilter ref="A1:${columnName(colCount)}${Math.max(rows.length, 1)}"/>
</worksheet>`;
}

function worksheetCellXml(row: number, column: number, value: ExportCell, isHeader: boolean) {
  const ref = `${columnName(column)}${row}`;
  const style = isHeader ? ' s="1"' : "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"${style}><v>${value}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${ref}" t="b"${style}><v>${value ? 1 : 0}</v></c>`;
  }
  const text = value === undefined || value === null ? "" : String(value);
  return `<c r="${ref}" t="inlineStr"${style}><is><t>${escapeXml(text)}</t></is></c>`;
}

function buildZip(files: Map<string, Uint8Array>) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  let offset = 0;

  files.forEach((data, path) => {
    const name = encoder.encode(path);
    const crc = crc32(data);
    const local = concatBytes(
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    );
    chunks.push(local);
    centralDirectory.push(
      concatBytes(
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ),
    );
    offset += local.length;
  });

  const centralStart = offset;
  const central = concatBytes(...centralDirectory);
  const end = concatBytes(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.size),
    u16(files.size),
    u32(central.length),
    u32(centralStart),
    u16(0),
  );

  return concatBytes(...chunks, central, end);
}

function encodeXml(value: string) {
  return new TextEncoder().encode(value);
}

function concatBytes(...parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
}

function u16(value: number) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function columnName(column: number) {
  let name = "";
  let current = column;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function JsonBlock({
  data,
  title,
}: {
  data: Record<string, unknown>;
  title: string;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#d9dee7]">
      <h4 className="border-b border-[#d9dee7] bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-[#344054]">
        {title}
      </h4>
      <pre className="max-h-[520px] overflow-auto bg-[#101828] p-4 text-xs leading-relaxed text-[#e4e7ec]">
        {JSON.stringify(data, null, 2)}
      </pre>
    </section>
  );
}

export default App;
