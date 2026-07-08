import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ColumnDef,
  DateMode,
  DateRange,
  OrdersProgress,
  OrderRow,
  ShopeeConfig,
} from "./shopeeApi";
import { streamOrdersWithEscrow } from "./shopeeApi";

type Page = "orders" | "columns" | "excel";

const STORAGE_KEYS = {
  shopeeConfig: "gntech.shopee.config",
  visibleColumns: "gntech.orders.visibleColumns",
  visibleExcelSkuColumns: "gntech.excel.skuColumns",
  dateMode: "gntech.orders.dateMode",
  rangeFrom: "gntech.orders.rangeFrom",
  rangeTo: "gntech.orders.rangeTo",
  theme: "gntech.theme",
};

const fallbackColumns: ColumnDef[] = [
  { key: "order_sn", label: "Mã đơn" },
  { key: "order_status", label: "Trạng thái" },
  { key: "create_time", label: "Ngày tạo", type: "date" },
  { key: "completion_time", label: "Ngày hoàn thành", type: "date" },
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
  apiBaseUrl: "https://shopee-worker.gntech.vn",
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
      apiBaseUrl: defaultConfig.apiBaseUrl,
    } as T;
  } catch {
    return fallback;
  }
}

function loadString(key: string, fallback: string): string {
  try {
    const value = localStorage.getItem(key);
    return value ? value : fallback;
  } catch {
    return fallback;
  }
}

function parseDateMode(value: string): DateMode {
  return value === "paid" || value === "completed" || value === "created"
    ? value
    : "paid";
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
  const [range, setRange] = useState<DateRange>(() => {
    const savedFrom = loadString(STORAGE_KEYS.rangeFrom, "");
    const savedTo = loadString(STORAGE_KEYS.rangeTo, "");
    return {
      from: savedFrom || todayInputValue(-13),
      to: savedTo || todayInputValue(),
    };
  });
  const [dateMode, setDateMode] = useState<DateMode>(() =>
    parseDateMode(loadString(STORAGE_KEYS.dateMode, "paid")),
  );
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = loadString(STORAGE_KEYS.theme, "");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem(STORAGE_KEYS.theme, theme);
    } catch {
      // ignore
    }
  }, [theme]);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [columns, setColumns] = useState<ColumnDef[]>(fallbackColumns);
  const [visibleColumns, setVisibleColumns] =
    useState<string[]>(loadVisibleColumns);
  const [visibleExcelSkuColumns, setVisibleExcelSkuColumns] = useState<
    string[]
  >(() =>
    ensureExcelColumns(
      loadStringList(STORAGE_KEYS.visibleExcelSkuColumns, defaultExcelSkuColumns),
      requiredOrderStatusExcelColumns,
    ),
  );
  const [selectedRow, setSelectedRow] = useState<OrderRow | null>(null);
  // 'idle' = Tải dữ liệu primary; 'data-ready' = Export primary; 'exporting' = đang xuất.
  const [loadPhase, setLoadPhase] = useState<"idle" | "loading" | "data-ready" | "exporting">("idle");
  const [loadProgress, setLoadProgress] = useState<OrdersProgress | null>(null);
  const [error, setError] = useState("");

  const activeColumns = useMemo(
    () => columns.filter((column) => visibleColumns.includes(column.key)),
    [columns, visibleColumns],
  );

  const totals = useMemo(
    () => ({
      orders: rows.length,
      // Đơn giá sau giảm theo order = order_discounted_price + |seller_return_refund|
      // (cộng ngược tiền hoàn để ra giá trước hoàn, khớp dòng Order trong Excel).
      discountedTotal: rows.reduce((sum, row) => {
        const discounted = numberValue(row.values.order_discounted_price);
        const refund = Math.abs(numberValue(row.values.seller_return_refund));
        return sum + discounted + refund;
      }, 0),
      refundTotal: rows.reduce(
        (sum, row) => sum + numberValue(row.values.seller_return_refund),
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

  function updateVisibleExcelSkuColumns(nextColumns: string[]) {
    setVisibleExcelSkuColumns(nextColumns);
    localStorage.setItem(
      STORAGE_KEYS.visibleExcelSkuColumns,
      JSON.stringify(nextColumns),
    );
  }

  function updateDateMode(nextMode: DateMode) {
    setDateMode(nextMode);
    try {
      localStorage.setItem(STORAGE_KEYS.dateMode, nextMode);
    } catch {
      // ignore storage errors
    }
  }

  function updateRange(nextRange: DateRange) {
    setRange(nextRange);
    try {
      localStorage.setItem(STORAGE_KEYS.rangeFrom, nextRange.from);
      localStorage.setItem(STORAGE_KEYS.rangeTo, nextRange.to);
    } catch {
      // ignore storage errors
    }
  }

  async function loadOrders() {
    setError("");

    if (!isDateRangeValid(range)) {
      setError("Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc.");
      return;
    }

    setLoadPhase("loading");
    setLoadProgress(null);
    try {
      const result = await streamOrdersWithEscrow(config, range, dateMode, (progress) =>
        setLoadProgress(progress),
      );
      setRows(result.rows);
      setColumns(result.columns.length > 0 ? result.columns : fallbackColumns);
      setVisibleColumns((current) => {
        const validKeys = new Set(result.columns.map((column) => column.key));
        // Giữ các cột user đã chọn (vẫn còn hợp lệ trong API),
        // đồng thời tự thêm các cột mặc định (vd: completion_time) mà chưa hiển thị.
        const next = current.filter((key) => validKeys.has(key));
        for (const key of defaultVisibleColumns) {
          if (validKeys.has(key) && !next.includes(key)) {
            next.push(key);
          }
        }
        return next.length > 0 ? next : defaultVisibleColumns;
      });
      setSelectedRow(null);
      setLoadPhase("data-ready");
      setLoadProgress(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không tải được dữ liệu Shopee.",
      );
      setLoadPhase("idle");
      setLoadProgress(null);
    }
  }

  function exportOrders() {
    if (rows.length === 0) {
      setError("Chưa có dữ liệu để export.");
      return;
    }

    setError("");
    setLoadPhase("exporting");
    try {
      exportRevenueWorkbook(rows, range, {
        skuColumns: visibleExcelSkuColumns,
      });
      // Sau khi xuất xong, nút Tải dữ liệu quay về primary.
      setLoadPhase("idle");
    } catch {
      setLoadPhase("data-ready");
    }
  }

  return (
    <main className="min-h-svh bg-canvas text-primary">
      <div className="mx-auto flex min-h-svh max-w-[1440px]">
        <aside className="hidden w-64 border-r border-border bg-surface px-4 py-5 lg:block">
          <div className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              GNTech
            </p>
            <h1 className="mt-1 text-xl font-semibold text-primary">
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
          <div className="mt-8">
            <ThemeToggleButton theme={theme} onToggle={setTheme} />
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-border bg-surface px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-muted">
                  Order detail + payment escrow detail qua backend worker
                </p>
                <h2 className="text-2xl font-semibold text-primary">
                  {page === "orders"
                    ? "Đối soát đơn hàng"
                    : page === "columns"
                      ? "Cấu hình cột hiển thị"
                      : "Cấu hình Excel"}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <ThemeToggleButton theme={theme} onToggle={setTheme} compact />
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
            </div>
          </header>

          {page === "orders" ? (
            <OrdersPage
              activeColumns={activeColumns}
              config={config}
              dateMode={dateMode}
              error={error}
              onConfigChange={updateConfig}
              onDateModeChange={updateDateMode}
              onExportOrders={exportOrders}
              onLoadOrders={loadOrders}
              onRangeChange={updateRange}
              onSelectRow={setSelectedRow}
              range={range}
              rows={rows}
              loadPhase={loadPhase}
              loadProgress={loadProgress}
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
              skuColumns={visibleExcelSkuColumns}
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

function ThemeToggleButton({
  theme,
  onToggle,
  compact = false,
}: {
  theme: "light" | "dark";
  onToggle: (theme: "light" | "dark") => void;
  compact?: boolean;
}) {
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      aria-label={isDark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
      title={isDark ? "Giao diện sáng" : "Giao diện tối"}
      onClick={() => onToggle(isDark ? "light" : "dark")}
      className={
        compact
          ? "inline-flex h-9 w-9 items-center justify-center rounded-full border border-border-strong text-secondary transition-colors hover:bg-hover"
          : "inline-flex w-full items-center gap-3 rounded-full px-3 py-2.5 text-left text-sm font-medium text-secondary transition-colors hover:bg-hover"
      }
    >
      <span className="inline-flex h-5 w-5 items-center justify-center">
        {isDark ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
            <path d="M12 18a6 6 0 1 1 0-12 6 6 0 0 1 0 12Zm0-14a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V5a1 1 0 0 1 1-1Zm0 14a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1ZM4.9 4.9a1 1 0 0 1 1.4 0l.7.7A1 1 0 1 1 5.6 7l-.7-.7a1 1 0 0 1 0-1.4Zm12 12a1 1 0 0 1 1.4 0l.7.7a1 1 0 0 1-1.4 1.4l-.7-.7a1 1 0 0 1 0-1.4ZM2 12a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1Zm14 0a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2h-1a1 1 0 0 1-1-1ZM4.9 19.1a1 1 0 0 1 0-1.4l.7-.7A1 1 0 1 1 7 18.4l-.7.7a1 1 0 0 1-1.4 0Zm12-12a1 1 0 0 1 0-1.4l.7-.7A1 1 0 0 1 19 5.6l-.7.7a1 1 0 0 1-1.4 0Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
            <path d="M21.64 13a1 1 0 0 0-1.05-.78 8.5 8.5 0 0 1-9.8-9.8A1 1 0 0 0 10 1.36 10.5 10.5 0 1 0 22.64 14a1 1 0 0 0-1-1Z" />
          </svg>
        )}
      </span>
      {!compact && <span>{isDark ? "Giao diện sáng" : "Giao diện tối"}</span>}
    </button>
  );
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
          ? "bg-accent-soft text-accent"
          : "text-secondary hover:bg-hover"
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
  dateMode,
  error,
  onConfigChange,
  onDateModeChange,
  onExportOrders,
  onLoadOrders,
  onRangeChange,
  onSelectRow,
  range,
  rows,
  loadPhase,
  loadProgress,
  totals,
}: {
  activeColumns: ColumnDef[];
  config: ShopeeConfig;
  dateMode: DateMode;
  error: string;
  onConfigChange: (config: ShopeeConfig) => void;
  onDateModeChange: (mode: DateMode) => void;
  onExportOrders: () => void;
  onLoadOrders: () => void;
  onRangeChange: (range: DateRange) => void;
  onSelectRow: (row: OrderRow) => void;
  range: DateRange;
  rows: OrderRow[];
  loadPhase: "idle" | "loading" | "data-ready" | "exporting";
  loadProgress: OrdersProgress | null;
  totals: { orders: number; discountedTotal: number; refundTotal: number };
}) {
  return (
    <div className="flex-1 space-y-5 overflow-auto p-4 sm:p-6">
      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="grid gap-3 lg:max-w-sm">
          <TextInput
            label="Shop ID"
            value={config.shopId}
            onChange={(value) =>
              onConfigChange({
                ...config,
                apiBaseUrl: defaultConfig.apiBaseUrl,
                shopId: value,
              })
            }
          />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,520px)_auto_auto_auto] lg:items-end">
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
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-secondary">Chế độ ngày</span>
            <select
              className="h-10 rounded-md border border-border-strong bg-surface px-3 text-sm text-primary focus:border-accent focus:outline-none"
              value={dateMode}
              onChange={(event) =>
                onDateModeChange(parseDateMode(event.target.value))
              }
            >
              <option value="created">Ngày đặt hàng</option>
              <option value="paid">Ngày hoàn thành thanh toán (Ngày Shopee trả tiền cho shop bán hàng)</option>
              <option value="completed">Ngày hoàn thành</option>
            </select>
          </label>
          <button
            type="button"
            className={`h-10 rounded-full px-5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              loadPhase === "idle" || loadPhase === "loading"
                ? "bg-accent text-white hover:bg-accent-hover disabled:bg-accent-disabled"
                : "border border-border-strong bg-surface text-secondary hover:bg-canvas"
            }`}
            disabled={loadPhase === "loading" || loadPhase === "exporting"}
            onClick={onLoadOrders}
          >
            {loadPhase === "loading" ? (
              <span className="inline-flex items-center gap-2">
                <Spinner /> Đang tải...
              </span>
            ) : (
              "Tải dữ liệu"
            )}
          </button>
          <button
            type="button"
            className={`h-10 rounded-full px-5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              loadPhase === "data-ready" || loadPhase === "exporting"
                ? "bg-accent text-white hover:bg-accent-hover disabled:bg-accent-disabled"
                : "border border-border-strong bg-surface text-secondary hover:bg-canvas"
            }`}
            disabled={loadPhase === "loading" || rows.length === 0}
            onClick={onExportOrders}
          >
            {loadPhase === "exporting" ? (
              <span className="inline-flex items-center gap-2">
                <Spinner /> Đang xuất...
              </span>
            ) : (
              "Export XLSX"
            )}
          </button>
        </div>
        {loadPhase === "loading" ? (
          <LoadProgress progress={loadProgress} dateMode={dateMode} />
        ) : null}
        {error ? (
          <div className="mt-3 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        ) : null}
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Metric label="Số đơn" value={String(totals.orders)} />
        <Metric label="Tổng đơn giá sau giảm" value={formatCurrency(totals.discountedTotal)} />
        <Metric label="Tổng số tiền hoàn" value={formatCurrency(totals.refundTotal)} />
      </section>

      <DataTable
        columns={activeColumns}
        rows={rows}
        onSelectRow={onSelectRow}
      />
    </div>
  );
}

const LOAD_PHASE_LABELS: Record<OrdersProgress["phase"], string> = {
  income: "Lấy danh sách thanh toán",
  orders: "Lấy danh sách đơn hàng",
  detail: "Lấy chi tiết đơn hàng",
  escrow: "Lấy thông tin escrow & hoàn/trả",
};

function LoadProgress({
  progress,
  dateMode,
}: {
  progress: OrdersProgress | null;
  dateMode: DateMode;
}) {
  // Thứ tự các phase tùy dateMode: paid không có phase 'orders'.
  const phases: OrdersProgress["phase"][] =
    dateMode === "paid"
      ? ["income", "detail", "escrow"]
      : ["orders", "detail", "escrow"];
  const currentPhase = progress?.phase;
  const currentIndex = currentPhase ? phases.indexOf(currentPhase) : -1;

  return (
    <div className="mt-3 rounded-md border border-border-strong bg-canvas px-4 py-3">
      <ul className="space-y-2">
        {phases.map((phase, index) => {
          const isDone = currentIndex > index;
          const isActive = currentIndex === index;
          return (
            <li
              key={phase}
              className="flex items-center gap-2 text-sm"
            >
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                {isDone ? (
                  <CheckIcon />
                ) : isActive ? (
                  <Spinner />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-border-strong" />
                )}
              </span>
              <span
                className={
                  isActive
                    ? "font-medium text-primary"
                    : isDone
                      ? "text-muted line-through"
                      : "text-muted"
                }
              >
                {LOAD_PHASE_LABELS[phase]}
              </span>
              {isActive && progress && progress.total > 0 ? (
                <span className="ml-auto font-mono text-xs text-muted">
                  {progress.loaded}/{progress.total}
                </span>
              ) : isActive && progress && progress.loaded > 0 ? (
                <span className="ml-auto font-mono text-xs text-muted">
                  {progress.loaded}...
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-current"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-4 w-4 text-accent"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
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
      <section className="max-w-5xl rounded-lg border border-border bg-surface p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-primary">
              Cột trong bảng đơn hàng
            </h3>
            <p className="text-sm text-muted">
              Tick những field cần xem trong data table.
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-secondary hover:bg-canvas"
            onClick={() => onVisibleColumnsChange(defaultVisibleColumns)}
          >
            Mặc định
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {columns.map((column) => (
            <label
              key={column.key}
              className="flex cursor-pointer items-center justify-between rounded-md border border-code-text px-3 py-2 hover:bg-hover"
            >
              <span className="min-w-0 pr-3">
                <span className="block truncate text-sm font-medium text-primary">
                  {column.label}
                </span>
                <span className="block truncate font-mono text-xs text-muted">
                  {column.key}
                </span>
              </span>
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-accent"
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
  skuColumns,
  onSkuColumnsChange,
}: {
  skuColumns: string[];
  onSkuColumnsChange: (columns: string[]) => void;
}) {
  return (
    <div className="flex-1 space-y-5 overflow-auto p-4 sm:p-6">
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
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-primary">{title}</h3>
          <p className="text-sm text-muted">{description}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-secondary hover:bg-canvas"
            onClick={() => onSelectedColumnsChange(excelColumns.map((column) => column.key))}
          >
            Chọn tất cả
          </button>
          <button
            type="button"
            className="rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-secondary hover:bg-canvas"
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
            className="flex cursor-pointer items-center justify-between rounded-md border border-code-text px-3 py-2 hover:bg-hover"
          >
            <span className="min-w-0 pr-3">
              <span className="block truncate text-sm font-medium text-primary">
                {column.label}
              </span>
              <span className="block truncate font-mono text-xs text-muted">
                {column.key}
              </span>
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-accent"
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
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      <input
        className="h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent-ring"
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
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
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
          className="flex h-10 w-10 items-center justify-center rounded-md border border-border-strong bg-surface text-secondary transition-colors hover:bg-canvas focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring"
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
        className="h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-center text-sm text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent-ring"
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
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold text-primary">
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
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-base font-semibold text-primary">Data table</h3>
        <span className="text-sm text-muted">{rows.length} đơn</span>
      </div>
      <div className="overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 bg-hover">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`whitespace-nowrap border-b border-border px-4 py-3 font-semibold text-secondary ${
                    column.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {column.label}
                </th>
              ))}
              <th className="border-b border-border px-4 py-3 text-right font-semibold text-secondary">
                Chi tiết
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  className="px-4 py-12 text-center text-muted"
                  colSpan={columns.length + 1}
                >
                  Chưa có dữ liệu. Nhập Backend API URL, Shop ID và chọn khoảng
                  ngày để tải đơn.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.order_sn} className="hover:bg-hover">
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`max-w-[280px] truncate whitespace-nowrap border-b border-border px-4 py-3 text-primary ${
                        column.align === "right" ? "text-right font-medium" : ""
                      }`}
                      title={String(row.values[column.key] ?? "")}
                    >
                      {formatCell(row, column)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap border-b border-border px-4 py-3 text-right">
                    <button
                      type="button"
                      className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-secondary hover:bg-hover"
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
      <aside className="h-full w-full max-w-5xl overflow-auto bg-surface shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface px-5 py-4">
          <div>
            <p className="text-sm text-muted">Chi tiết đơn và escrow</p>
            <h3 className="text-lg font-semibold text-primary">
              {row.order_sn}
            </h3>
          </div>
          <button
            type="button"
            className="rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-secondary hover:bg-hover"
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
    <section className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border bg-hover px-4 py-3">
        <h4 className="text-sm font-semibold text-secondary">Sản phẩm trong đơn</h4>
        <span className="text-sm text-muted">{items.length} dòng</span>
      </div>
      <div className="overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="bg-surface">
            <tr>
              <th className="whitespace-nowrap border-b border-border px-4 py-3 font-semibold text-secondary">
                Sản phẩm
              </th>
              <th className="whitespace-nowrap border-b border-border px-4 py-3 font-semibold text-secondary">
                SKU
              </th>
              <th className="whitespace-nowrap border-b border-border px-4 py-3 font-semibold text-secondary">
                Phân loại
              </th>
              <th className="whitespace-nowrap border-b border-border px-4 py-3 font-semibold text-secondary">
                SKU phân loại
              </th>
              <th className="whitespace-nowrap border-b border-border px-4 py-3 text-right font-semibold text-secondary">
                SL
              </th>
              <th className="whitespace-nowrap border-b border-border px-4 py-3 text-right font-semibold text-secondary">
                Giá gốc
              </th>
              <th className="whitespace-nowrap border-b border-border px-4 py-3 text-right font-semibold text-secondary">
                Giá bán
              </th>
              <th className="whitespace-nowrap border-b border-border px-4 py-3 text-right font-semibold text-secondary">
                Tạm tính
              </th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-center text-muted" colSpan={8}>
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
                    <td className="max-w-[360px] border-b border-border px-4 py-3 text-primary">
                      <div className="line-clamp-2">{asString(item.item_name) || "-"}</div>
                    </td>
                    <td className="whitespace-nowrap border-b border-border px-4 py-3 text-primary">
                      {asString(item.item_sku) || "-"}
                    </td>
                    <td className="max-w-[220px] truncate whitespace-nowrap border-b border-border px-4 py-3 text-primary">
                      {asString(item.model_name) || "-"}
                    </td>
                    <td className="whitespace-nowrap border-b border-border px-4 py-3 text-primary">
                      {asString(item.model_sku) || "-"}
                    </td>
                    <td className="whitespace-nowrap border-b border-border px-4 py-3 text-right font-medium text-primary">
                      {quantity || "-"}
                    </td>
                    <td className="whitespace-nowrap border-b border-border px-4 py-3 text-right text-primary">
                      {formatCurrency(originalPrice, row.currency)}
                    </td>
                    <td className="whitespace-nowrap border-b border-border px-4 py-3 text-right text-primary">
                      {formatCurrency(sellingPrice, row.currency)}
                    </td>
                    <td className="whitespace-nowrap border-b border-border px-4 py-3 text-right font-medium text-primary">
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
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
}

type ExportCell = string | number | boolean | null | undefined;
type RevenueExportRow = {
  rowType: "Order" | "Sku";
  values: Record<string, ExportCell>;
};

const orderStatusLabels: Record<string, string> = {
  UNPAID: "Chưa thanh toán",
  PENDING: "Chờ xác nhận",
  READY_TO_SHIP: "Sẵn sàng giao hàng",
  PROCESSED: "Đã xử lý",
  SHIPPED: "Đang giao hàng",
  COMPLETED: "Hoàn thành",
  IN_CANCEL: "Đang hủy",
  CANCELLED: "Đã hủy",
};

const excelColumns = [
  { key: "transaction_id", label: "Mã giao dịch" },
  { key: "row_type", label: "Đơn hàng / Sản phẩm" },
  { key: "order_sn", label: "Mã đơn hàng" },
  { key: "order_status", label: "Mã trạng thái đơn" },
  { key: "order_status_label", label: "Trạng thái đơn" },
  { key: "order_type", label: "Loại đơn hàng" },
  { key: "return_request_sn", label: "Mã yêu cầu hoàn tiền" },
  { key: "return_sn", label: "Mã yêu cầu hoàn/trả" },
  { key: "return_status", label: "Trạng thái hoàn/trả" },
  { key: "return_reason", label: "Lý do hoàn/trả" },
  { key: "item_id", label: "Mã sản phẩm" },
  { key: "item_name", label: "Tên sản phẩm" },
  { key: "model_name", label: "Phân loại" },
  { key: "item_sku", label: "SKU" },
  { key: "model_sku", label: "SKU Phân loại" },
  { key: "quantity", label: "Số lượng" },
  { key: "returned_quantity", label: "Số lượng hoàn/trả" },
  { key: "is_bestseller", label: "Sản Phẩm Bán Chạy" },
  { key: "create_time", label: "Ngày đặt hàng" },
  { key: "update_time", label: "Ngày cập nhật trạng thái" },
  { key: "completion_time", label: "Ngày nhận/hoàn thành" },
  { key: "pay_time", label: "Ngày hoàn thành thanh toán (Ngày Shopee trả tiền cho shop bán hàng)" },
  { key: "pickup_done_time", label: "Ngày lấy hàng" },
  { key: "ship_by_date", label: "Hạn giao vận" },
  { key: "payment_method", label: "Phương thức thanh toán" },
  { key: "buyer_payment_method", label: "Phương thức thanh toán của Người mua" },
  { key: "buyer_payment_method_details", label: "Buyer Payment Method Details_1" },
  { key: "instalment_plan", label: "Installment Plan (if applicable)" },
  { key: "shipping_carrier", label: "Đơn vị vận chuyển" },
  { key: "courier_name", label: "Courier Name" },
  { key: "tax_registration_code", label: "Mã Số Thuế" },

  { key: "product_price", label: "Đơn giá gốc" },
  { key: "seller_product_subsidy", label: "Số tiền bạn trợ giá cho sản phẩm" },
  { key: "seller_voucher", label: "Mã ưu đãi do Người Bán chịu" },
  { key: "seller_cofunded_voucher", label: "Mã ưu đãi Đồng Tài Trợ do Người Bán chịu" },
  { key: "seller_coin_cash_back", label: "Mã hoàn xu do Người Bán chịu" },
  { key: "seller_cofunded_coin_cash_back", label: "Mã hoàn xu Đồng Tài Trợ do Người Bán chịu" },
  { key: "voucher_code", label: "Mã voucher" },
  { key: "delivery_revenue", label: "Doanh thu khi giao hàng" },
  { key: "refund_amount", label: "Số tiền hoàn lại" },
  { key: "discounted_product_price", label: "Doanh thu sau giảm và hoàn hủy" },
  { key: "coins", label: "Shopee xu" },
  { key: "shopee_voucher", label: "Shopee voucher" },
  { key: "bank_credit_card_promotion", label: "Ngân hàng khuyến mãi thanh toán trên Thẻ Tín Dụng" },
  { key: "shopee_credit_card_promotion", label: "Shopee khuyến mãi thanh toán trên Thẻ Tín Dụng" },
  { key: "shopee_product_subsidy", label: "Sản phẩm được trợ giá từ Shopee" },
  { key: "trade_in_bonus_by_seller", label: "Trade-in Bonus by Seller" },

  { key: "buyer_total_amount", label: "Amount Paid By Buyer" },
  { key: "item_refund_amount", label: "Tiền hoàn của SKU" },
  { key: "return_item_price", label: "Tiền hàng hoàn của SKU" },

  { key: "vat_tax", label: "Thuế GTGT" },
  { key: "pit_tax", label: "Thuế TNCN" },

  { key: "commission_fee", label: "Phí cố định" },
  { key: "service_fee", label: "Phí Dịch Vụ" },
  { key: "seller_transaction_fee", label: "Phí xử lý giao dịch" },
  { key: "transaction_fee_rate", label: "Transaction Fee Rate (%)" },
  { key: "affiliate_commission_fee", label: "Phí hoa hồng Tiếp thị liên kết" },
  { key: "piship_service_fee", label: "Phí dịch vụ PiShip" },
  { key: "display_service_fee", label: "Phí dịch vụ hiển thị NTTD (từ doanh thu đơn hàng)" },
  { key: "buyer_paid_shipping_fee", label: "Phí vận chuyển Người mua trả" },
  { key: "actual_shipping_fee", label: "Phí vận chuyển thực tế" },
  { key: "shopee_shipping_rebate", label: "Phí vận chuyển được trợ giá từ Shopee" },
  { key: "shipping_fee_discount_from_3pl", label: "Shipping Fee Discount from 3PL" },
  { key: "seller_shipping_discount", label: "Phí vận chuyển - Người bán hỗ trợ" },
  { key: "reverse_shipping_fee", label: "Phí vận chuyển trả hàng (đơn Trả hàng/hoàn tiền)" },
  { key: "piship_shipping_refund", label: "Phí vận chuyển được hoàn bởi PiShip" },
  { key: "failed_delivery_return_shipping_fee", label: "Phí vận chuyển trả hàng (đơn giao không thành công)" },
  { key: "buyer_installation_fee", label: "Phí lắp đặt người mua trả" },

  { key: "lost_compensation", label: "Đền bù đơn mất hàng" },
  { key: "escrow_amount", label: "Tổng tiền đã thanh toán" },
  { key: "buyer_username", label: "Người Mua" },
];
const columnDefinitions: Record<string, string> = {
  transaction_id: "Số thứ tự dòng giao dịch (tự sinh theo thứ tự đơn).",
  row_type: "Loại dòng (chi tiết từng phân loại SKU).",
  order_sn: "Mã đơn hàng do Shopee cấp.",
  order_status: "Mã trạng thái đơn (vd. COMPLETED, CANCELLED, TO_RETURN).",
  order_status_label: "Trạng thái đơn bằng tiếng Việt.",
  order_type: "Loại đơn (mặc định: Đơn thường).",
  return_request_sn: "Mã yêu cầu hoàn tiền (nếu có).",
  return_sn: "Mã yêu cầu hoàn/trả hàng (nếu có).",
  return_status: "Trạng thái hoàn/trả: trống = không có yêu cầu; 'Không được hoàn' = có yêu cầu nhưng bị CANCELLED; 'Hoàn toàn bộ'/'Hoàn 1 phần' = return ACCEPTED, so |tiền hoàn| vs giá trước-hoàn.",
  return_reason: "Lý do hoàn/trả hàng.",
  item_id: "Mã sản phẩm (item).",
  item_name: "Tên sản phẩm.",
  model_name: "Tên phân loại (model).",
  item_sku: "SKU sản phẩm.",
  model_sku: "SKU phân loại (model).",
  quantity: "Số lượng mua của SKU (model_quantity_purchased).",
  returned_quantity: "Số lượng được chấp nhận hoàn/trả của SKU (chỉ tính return ACCEPTED).",
  is_bestseller: "Sản phẩm bán chạy (YES/NO).",
  create_time: "Ngày đặt hàng.",
  update_time: "Ngày cập nhật trạng thái đơn.",
  completion_time: "Ngày nhận/hoàn thành (khi COMPLETED).",
  pay_time: "Ngày Shopee thanh toán cho shop (actual_payout_time).",
  pickup_done_time: "Ngày lấy hàng.",
  ship_by_date: "Hạn giao vận.",
  payment_method: "Phương thức thanh toán.",
  buyer_payment_method: "Phương thức thanh toán của người mua.",
  buyer_payment_method_details: "Chi tiết phương thức thanh toán của người mua.",
  instalment_plan: "Khoản trả góp (nếu có).",
  shipping_carrier: "Đơn vị vận chuyển.",
  courier_name: "Tên courier (gói hàng đầu tiên).",
  tax_registration_code: "Mã số thuế của shop.",

  product_price: "Đơn giá gốc (trước giảm) = model_original_price.",
  seller_product_subsidy: "Số tiền shop trợ giá cho sản phẩm (giảm trực tiếp, không qua voucher) = seller_discount.",
  discounted_product_price: "Doanh thu sau giảm và hoàn hủy = Đơn giá gốc − Trợ giá shop. SKU đã hoàn = phần còn lại (0 nếu hoàn toàn bộ).",
  delivery_revenue: "Doanh thu khi giao hàng = Doanh thu sau giảm và hoàn hủy + Tiền hoàn SKU − (Mã ưu đãi do NB chịu + Mã ưu đãi Đồng tài trợ do NB chịu + Mã hoàn xu do NB chịu + Mã hoàn xu Đồng tài trợ do NB chịu).",
  refund_amount: "Số tiền hoàn lại = |seller_return_refund| prorate theo selling_price (toàn bộ tiền shop trả lại Shopee, gồm cả phần voucher Shopee).",
  seller_voucher: "Mã ưu đãi do Người bán chịu (voucher shop phát hành).",
  seller_cofunded_voucher: "Mã ưu đãi Đồng tài trợ do Người bán chịu.",
  seller_coin_cash_back: "Mã hoàn xu do Người bán chịu (không có ở mức SKU, để trống).",
  seller_cofunded_coin_cash_back: "Mã hoàn xu Đồng tài trợ do Người bán chịu (không có ở mức SKU, để trống).",
  voucher_code: "Mã voucher đã dùng.",
  coins: "Shopee xu (xu giảm giá người mua dùng) = discount_from_coin.",
  shopee_voucher: "Voucher do Shopee tài trợ (KHÔNG thuộc doanh thu sản phẩm shop). SKU = discount_from_voucher_shopee.",
  bank_credit_card_promotion: "Khuyến mãi thanh toán thẻ tín dụng do Ngân hàng.",
  shopee_credit_card_promotion: "Khuyến mãi thanh toán thẻ tín dụng do Shopee.",
  shopee_product_subsidy: "Sản phẩm được trợ giá từ Shopee (shopee_discount).",
  trade_in_bonus_by_seller: "Trade-in Bonus do shop chịu.",

  buyer_total_amount: "Tổng tiền người mua trả.",
  item_refund_amount: "Tiền hoàn của SKU = |seller_return_refund| prorate theo selling_price (toàn bộ tiền shop trả lại Shopee).",
  return_item_price: "Tiền hàng hoàn của SKU (= Tiền hoàn của SKU).",

  vat_tax: "Thuế GTGT (withholding_vat_tax / final_product_vat_tax).",
  pit_tax: "Thuế TNCN (withholding_pit_tax).",

  commission_fee: "Phí cố định (commission_fee / net_commission_fee).",
  service_fee: "Phí dịch vụ (service_fee / net_service_fee).",
  seller_transaction_fee: "Phí xử lý giao dịch.",
  transaction_fee_rate: "Tỷ lệ phí giao dịch (%).",
  affiliate_commission_fee: "Phí hoa hồng Tiếp thị liên kết (AMS).",
  piship_service_fee: "Phí dịch vụ PiShip (fbs_fee).",
  display_service_fee: "Phí dịch vụ hiển thị NTTD (từ doanh thu đơn).",
  buyer_paid_shipping_fee: "Phí vận chuyển người mua trả.",
  actual_shipping_fee: "Phí vận chuyển thực tế.",
  shopee_shipping_rebate: "Phí vận chuyển được trợ giá từ Shopee.",
  shipping_fee_discount_from_3pl: "Phí vận chuyển giảm từ 3PL.",
  seller_shipping_discount: "Phí vận chuyển người bán hỗ trợ.",
  reverse_shipping_fee: "Phí vận chuyển trả hàng (đơn trả/hoàn) = final_return_to_seller_shipping_fee.",
  piship_shipping_refund: "Phí vận chuyển được hoàn bởi PiShip = reverse_shipping_fee.",
  failed_delivery_return_shipping_fee: "Phí vận chuyển trả hàng (đơn giao không thành công) = reverse_shipping_fee_sst.",
  buyer_installation_fee: "Phí lắp đặt người mua trả.",

  lost_compensation: "Đền bù đơn mất hàng (seller_lost_compensation).",
  escrow_amount: "Tổng tiền Shopee đã thanh toán cho shop (sau mọi phí/thuế).",
  buyer_username: "Tên người mua.",
};
const excelColumnKeys = excelColumns.map((column) => column.key);
const defaultExcelSkuColumns = excelColumnKeys;
const requiredOrderStatusExcelColumns = [
  "order_status",
  "order_status_label",
  "create_time",
  "update_time",
  "completion_time",
  "pay_time",
  "pickup_done_time",
  "ship_by_date",
  "return_sn",
  "return_status",
  "return_reason",
  "returned_quantity",
  "item_refund_amount",
  "return_item_price",
];

function ensureExcelColumns(columns: string[], requiredColumns: string[]) {
  const selected = new Set(columns);
  requiredColumns.forEach((key) => selected.add(key));
  return excelColumnKeys.filter((key) => selected.has(key));
}

function exportRevenueWorkbook(
  rows: OrderRow[],
  range: DateRange,
  config: { skuColumns: string[] },
) {
  const exportRows = buildRevenueExportRows(rows);
  const selectedColumns = excelColumns.filter((column) =>
    config.skuColumns.includes(column.key),
  );
  const dataRows = exportRows.map((row) =>
    selectedColumns.map((column) => row.values[column.key] ?? ""),
  );
  const workbookRows: ExportCell[][] = [
    selectedColumns.map((column) => columnDefinitions[column.key] ?? ""),
    selectedColumns.map((column) => column.label),
    ...dataRows,
  ];
  const workbook = createXlsxWorkbook("Doanh thu", workbookRows, {
    definitionRows: 1,
    headerRows: 1,
  });
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
    const incomeDetail = asRecord(escrow.income_detail);
    const buyerPayment = asRecord(escrow.buyer_payment_info);
    const returnDetails = asArray(escrow.return_details).map(asRecord);
    const packageList = asArray(order.package_list).map(asRecord);
    const firstPackage = packageList[0] ?? {};
    const orderItems = asArray(order.item_list).map(asRecord);
    const incomeItems = asArray(income.items).map(asRecord);
    const orderSn = asString(order.order_sn) || row.order_sn;
    const itemRows = orderItems.length > 0 ? orderItems : incomeItems;

    // Tính refund thực tế từng SKU = phân bổ |seller_return_refund| (order-level)
    // cho các SKU có return ACCEPTED, prorated theo selling_price.
    // Khớp với file Income Shopee (cột "Giá sản phẩm" / "Số tiền hoàn lại" dòng SKU),
    // xử lý đúng cả hoàn một phần (partial refund).
    const orderRefundTotal = Math.abs(asNumber(valueFrom(income, "seller_return_refund")) ?? 0);
    const skuRefunds = computeSkuRefunds(itemRows, incomeItems, returnDetails, orderRefundTotal);
    const prorateRatios = computeProrateRatios(itemRows, incomeItems);

    itemRows.forEach((item, itemIndex) => {
      const incomeItem = findIncomeItem(incomeItems, item);
      output.push(
        revenueRow({
          index: transactionIndex++,
          rowType: "Sku",
          order,
          income,
          incomeDetail,
          buyerPayment,
          returnDetails,
          firstPackage,
          orderSn,
          item,
          incomeItem,
          skuRefund: skuRefunds[itemIndex],
          prorateRatio: prorateRatios[itemIndex],
          isFirstSku: itemIndex === 0,
        }),
      );
    });
  });

  return output;
}

// Tính tiền hoàn của SKU = phân bổ |seller_return_refund| (order-level) cho các SKU có
// return được chấp nhận, prorate theo selling_price.
// Đây là TOÀN BỘ tiền shop trả lại Shopee (gồm cả phần voucher Shopee thu lại), khớp
// với cột "Số tiền hoàn lại" (dòng SKU) trong file Income Shopee.
// Lưu ý: KHÔNG dùng `item.refund_amount` từ return detail vì đó là tiền buyer được hoàn
// (= selling_price − voucher), không phải tiền shop trả lại Shopee.
// SKU không có return được chấp nhận → refund = 0.
function computeSkuRefunds(
  itemRows: Record<string, unknown>[],
  incomeItems: Record<string, unknown>[],
  returnDetails: Record<string, unknown>[],
  totalRefund: number,
): number[] {
  const infos = itemRows.map((item) => {
    const incomeItem = findIncomeItem(incomeItems, item);
    const source =
      incomeItem && Object.keys(incomeItem).length > 0 ? incomeItem : {};
    const matched = findReturnItemsForItem(returnDetails, item, incomeItem);
    // Trạng thái được chấp nhận: khớp cả ACCEPTED và *_ACCEPTED (vd. RETURN_ACCEPTED).
    const acceptedItems = matched.filter((entry) =>
      String(entry.detail.status ?? "")
        .toUpperCase()
        .includes("ACCEPTED"),
    );
    const hasAccepted = acceptedItems.length > 0;
    const sellingPrice =
      asNumber(valueFrom(source, "selling_price", "discounted_price")) ??
      asNumber(item.model_discounted_price) ??
      0;
    return { hasAccepted, sellingPrice };
  });
  const acceptedInfos = infos.filter((info) => info.hasAccepted);
  const totalAcceptedSelling = acceptedInfos.reduce(
    (sum, info) => sum + (info.sellingPrice || 0),
    0,
  );

  return infos.map((info) => {
    if (!info.hasAccepted) return 0;
    if (totalAcceptedSelling <= 0) return 0;
    return totalRefund * (info.sellingPrice / totalAcceptedSelling);
  });
}

// Tỷ lệ prorate cho từng SKU theo selling_price, để phân bổ các field order-level
// (thuế, phí, escrow...) xuống SKU — khớp cách Shopee hiển thị ở file Income
// (sum các dòng SKU = dòng Order).
function computeProrateRatios(
  itemRows: Record<string, unknown>[],
  incomeItems: Record<string, unknown>[],
): number[] {
  const prices = itemRows.map((item) => {
    const incomeItem = findIncomeItem(incomeItems, item);
    const source =
      incomeItem && Object.keys(incomeItem).length > 0 ? incomeItem : {};
    return (
      asNumber(valueFrom(source, "selling_price", "discounted_price")) ??
      asNumber(item.model_discounted_price) ??
      0
    );
  });
  const total = prices.reduce((sum, p) => sum + (p || 0), 0);
  if (total <= 0) return prices.map(() => 0);
  return prices.map((p) => (p || 0) / total);
}

function revenueRow({
  index,
  rowType,
  order,
  income,
  incomeDetail,
  buyerPayment,
  returnDetails,
  firstPackage,
  orderSn,
  item,
  incomeItem,
  skuRefund,
  prorateRatio,
  isFirstSku,
}: {
  index: number;
  rowType: "Order" | "Sku";
  order: Record<string, unknown>;
  income: Record<string, unknown>;
  incomeDetail: Record<string, unknown>;
  buyerPayment: Record<string, unknown>;
  returnDetails: Record<string, unknown>[];
  firstPackage: Record<string, unknown>;
  orderSn: string;
  item?: Record<string, unknown>;
  incomeItem?: Record<string, unknown>;
  skuRefund?: number;
  prorateRatio?: number;
  isFirstSku?: boolean;
}): RevenueExportRow {
  const isSku = rowType === "Sku";
  const source = incomeItem && Object.keys(incomeItem).length > 0 ? incomeItem : income;
  const quantity = item ? asNumber(item.model_quantity_purchased) : undefined;
  const orderItemOriginalPrice = item ? asNumber(item.model_original_price) : undefined;
  const orderItemDiscountedPrice = item ? asNumber(item.model_discounted_price) : undefined;
  const incomeItemOriginalPrice = asNumber(valueFrom(source, "original_price", "original_price_pri"));
  const incomeItemDiscountedPrice = asNumber(valueFrom(source, "selling_price", "discounted_price"));
  const incomeItemSellerDiscount = asNumber(valueFrom(source, "seller_discount"));
  const incomeItemPriceAfterSellerDiscount =
    typeof incomeItemOriginalPrice === "number" && typeof incomeItemSellerDiscount === "number"
      ? incomeItemOriginalPrice - incomeItemSellerDiscount
      : undefined;
  const itemOriginalPrice = incomeItemOriginalPrice ?? orderItemOriginalPrice;
  const itemDiscountedPrice =
    incomeItemDiscountedPrice ?? incomeItemPriceAfterSellerDiscount ?? orderItemDiscountedPrice;
  const orderStatus = asString(order.order_status) || "";
  const paymentCompletedTime = valueFrom(incomeDetail, "actual_payout_time", "released_time") || order.pay_time;
  const matchedReturnItems = item ? findReturnItemsForItem(returnDetails, item, incomeItem) : [];
  const returnSummary = summarizeReturnItems(returnDetails, matchedReturnItems, isSku);
  const orderDiscountedPrice = valueFrom(income, "order_discounted_price", "order_selling_price");
  const orderRefundAmount = asNumber(valueFrom(income, "seller_return_refund"));
  // SKU: đơn giá sau giảm:
  // - SKU có hoàn trả + order hoàn toàn (|refund| >= order disc) -> 0.
  // - SKU có hoàn trả + order hoàn 1 phần -> order disc − |refund| (phần còn lại).
  // - SKU không hoàn trả -> giữ nguyên selling_price.
  // Order: cộng ngược refund để ra giá trước hoàn.
  const skuRefundAmount = isSku ? Math.round(skuRefund ?? 0) : 0;
  const orderRefundAbs = Math.abs(orderRefundAmount ?? 0);
  const orderDiscPreRefund = asNumber(addRefundBackToAmount(orderDiscountedPrice, orderRefundAmount)) ?? 0;
  const returnedQuantity = asNumber(returnSummary.quantity) ?? 0;
  const skuHasReturn = returnedQuantity > 0 || skuRefundAmount > 0;
  const discountedProductPrice = isSku
    ? skuHasReturn
      ? Math.max(0, Math.round(orderDiscPreRefund - orderRefundAbs))
      : subtractRefundFromAmount(itemDiscountedPrice, 0)
    : addRefundBackToAmount(orderDiscountedPrice, orderRefundAmount);
  // Các field mức Order (thuế, phí, escrow, shipping...) không có ở mức SKU.
  // Các field mức Order (thuế, phí, escrow, shipping...) không có ở mức SKU.
  // Prorate theo selling_price xuống SKU (khớp file Income Shopee: sum SKU = Order).
  // Một số field Shopee để trống ở SKU → trả "".
  const ratio = prorateRatio ?? 0;
  const prorate = (...keys: string[]) => {
    const value = asNumber(valueFrom(income, ...keys)) ?? 0;
    return Math.round(value * ratio);
  };
  // Phí vận chuyển / escrow: Shopee prorate theo cơ sở khác (cân nặng), không phải
  // selling_price → prorate theo giá sẽ sai. Hiện nguyên giá trị order ở dòng SKU đầu,
  // trống ở các SKU sau (sum đúng, không nhân đôi).
  const firstSkuOnly = (...keys: string[]) =>
    isFirstSku ? valueFrom(income, ...keys) : "";
  const orderOnly = (...keys: string[]) => valueFrom(income, ...keys);
  const skuOnly = (...keys: string[]) => (isSku ? valueFrom(source, ...keys) : valueFrom(income, ...keys));

  // "Doanh thu khi giao hàng" = selling_price − các khoản giảm do Người bán chịu.
  // selling_price = Đơn giá sau giảm + Tiền hoàn SKU (phần còn lại + phần hoàn = giá gốc).
  // Trừ thêm: Mã ưu đãi do NB chịu, Mã ưu đãi Đồng tài trợ do NB chịu,
  // Mã hoàn xu do NB chịu, Mã hoàn xu Đồng tài trợ do NB chịu
  // (các khoản shop tự bỏ tiền, không phải Shopee tài trợ).
  const sellerBorneDiscount =
    (asNumber(skuOnly("discount_from_voucher_seller", "voucher_from_seller")) ?? 0) +
    0 + // seller_cofunded_voucher: không có field mức SKU
    0 + // seller_coin_cash_back: không có field mức SKU
    0;  // seller_cofunded_coin_cash_back: không có field mức SKU
  const deliveryRevenue =
    (asNumber(discountedProductPrice) ?? 0) + skuRefundAmount - sellerBorneDiscount;

  // Trạng thái hoàn/trả (tiếng Việt):
  // - Không có yêu cầu hoàn/trả (không có return_sn): để trống.
  // - Có yêu cầu nhưng không có return ACCEPTED (CANCELLED/REQUESTED/...):
  //   "Không được hoàn".
  // - Có return ACCEPTED: so |seller_return_refund| với giá trước hoàn của đơn
  //   (order-level, nhất quán cho cả dòng Order và SKU):
  //   >= -> "Hoàn toàn bộ"; < -> "Hoàn 1 phần".
  const hasReturnRequest = Boolean(returnSummary.returnSn);
  const hasAcceptedReturn = isSku
    ? skuHasReturn
    : returnDetails.some((detail) =>
        String(asString(detail.status) ?? "").toUpperCase().includes("ACCEPTED"),
      );
  const returnStatusVi = !hasReturnRequest
    ? ""
    : !hasAcceptedReturn
      ? "Không được hoàn"
      : refundStatusVietnamese(orderRefundAbs, orderDiscPreRefund);

  return {
    rowType,
    values: {
      transaction_id: index,
      row_type: rowType,
      order_sn: orderSn,
      order_status: orderStatus,
      order_status_label: orderStatusLabels[orderStatus] ?? orderStatus,
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
      seller_product_subsidy: isSku ? skuOnly("seller_discount") : orderOnly("order_seller_discount", "seller_discount"),
      discounted_product_price: discountedProductPrice,
      shopee_product_subsidy: skuOnly("shopee_discount"),
      is_bestseller: "NO",
      create_time: excelDate(order.create_time),
      update_time: excelDate(order.update_time),
      completion_time: orderStatus === "COMPLETED" ? excelDate(order.update_time) : "",
      pay_time: excelDate(paymentCompletedTime),
      pickup_done_time: excelDate(order.pickup_done_time),
      ship_by_date: excelDate(order.ship_by_date),
      payment_method: valueFrom(order, "payment_method"),
      buyer_payment_method: orderOnly("buyer_payment_method", "payment_method"),
      buyer_payment_method_details: isSku ? "" : valueFrom(buyerPayment, "buyer_payment_method"),
      instalment_plan: orderOnly("instalment_plan"),
      escrow_amount: firstSkuOnly("escrow_amount"),
      buyer_total_amount: "",
      refund_amount: isSku ? (skuRefundAmount || "") : orderOnly("seller_return_refund"),
      return_sn: returnSummary.returnSn,
      return_status: returnStatusVi,
      return_reason: returnSummary.reason,
      returned_quantity: returnSummary.quantity,
      // SKU: tiền hoàn của SKU = refund thực tế (prorated từ seller_return_refund).
      // Order: để trống (sẽ dùng cột "Số tiền hoàn lại" order-level).
      item_refund_amount: isSku ? (skuRefundAmount || "") : returnSummary.refundAmount,
      return_item_price: isSku ? (skuRefundAmount || "") : returnSummary.itemPrice,
      delivery_revenue: Math.round(deliveryRevenue),
      lost_compensation: "",
      trade_in_bonus_by_seller: prorate("trade_in_bonus_by_seller"),
      seller_voucher: skuOnly("discount_from_voucher_seller", "voucher_from_seller"),
      seller_cofunded_voucher: "",
      seller_coin_cash_back: "",
      seller_cofunded_coin_cash_back: "",
      voucher_code: isSku ? "" : voucherCodes(income),
      coins: skuOnly("discount_from_coin", "coins"),
      shopee_voucher: skuOnly("discount_from_voucher_shopee", "voucher_from_shopee"),
      bank_credit_card_promotion: "",
      shopee_credit_card_promotion: "",
      commission_fee: prorate("commission_fee", "net_commission_fee"),
      service_fee: prorate("service_fee", "net_service_fee"),
      seller_transaction_fee: prorate("seller_transaction_fee"),
      transaction_fee_rate: "",
      affiliate_commission_fee: skuOnly("ams_commission_fee", "order_ams_commission_fee"),
      piship_service_fee: "",
      display_service_fee: prorate("ads_escrow_top_up_fee_or_technical_support_fee"),
      vat_tax: prorate("withholding_vat_tax", "final_product_vat_tax"),
      pit_tax: prorate("withholding_pit_tax"),
      buyer_paid_shipping_fee: firstSkuOnly("buyer_paid_shipping_fee"),
      actual_shipping_fee: firstSkuOnly("actual_shipping_fee"),
      shopee_shipping_rebate: firstSkuOnly("shopee_shipping_rebate"),
      shipping_fee_discount_from_3pl: firstSkuOnly("shipping_fee_discount_from_3pl"),
      seller_shipping_discount: "",
      reverse_shipping_fee: firstSkuOnly("final_return_to_seller_shipping_fee"),
      piship_shipping_refund: firstSkuOnly("reverse_shipping_fee"),
      failed_delivery_return_shipping_fee: firstSkuOnly("reverse_shipping_fee_sst"),
      shipping_carrier: valueFrom(order, "shipping_carrier"),
      courier_name: valueFrom(firstPackage, "shipping_carrier"),
      buyer_installation_fee: isFirstSku
        ? valueFrom(buyerPayment, "buyer_paid_packaging_fee")
        : "",
      buyer_username: valueFrom(order, "buyer_username"),
    },
  };
}

function addRefundBackToAmount(value: unknown, refundAmount: number | undefined) {
  const amount = asNumber(value);
  if (amount === undefined) return value as ExportCell;
  if (!refundAmount) return amount;
  return amount + Math.abs(refundAmount);
}

function subtractRefundFromAmount(value: unknown, refundAmount: number | undefined) {
  const amount = asNumber(value);
  if (amount === undefined) return value as ExportCell;
  if (!refundAmount) return amount;
  return amount - Math.abs(refundAmount);
}

function findReturnItemsForItem(
  returnDetails: Record<string, unknown>[],
  item: Record<string, unknown>,
  incomeItem?: Record<string, unknown>,
) {
  const itemId = asString(valueFrom(item, "item_id")) || asString(valueFrom(incomeItem || {}, "item_id"));
  const modelId = asString(valueFrom(item, "model_id")) || asString(valueFrom(incomeItem || {}, "model_id"));
  const itemSku = asString(valueFrom(item, "item_sku")) || asString(valueFrom(incomeItem || {}, "item_sku"));
  const modelSku =
    asString(valueFrom(item, "model_sku")) ||
    asString(valueFrom(item, "variation_sku")) ||
    asString(valueFrom(incomeItem || {}, "model_sku"));

  return returnDetails.flatMap((detail) =>
    asArray(detail.item)
      .map(asRecord)
      .filter((returnItem) => {
        const returnItemId = asString(returnItem.item_id);
        const returnModelId = asString(returnItem.model_id);
        const returnItemSku = asString(returnItem.item_sku);
        const returnVariationSku = asString(returnItem.variation_sku);

        if (itemId && returnItemId && itemId !== returnItemId) return false;
        if (modelId && returnModelId) return modelId === returnModelId;
        if (modelSku && returnVariationSku) return modelSku === returnVariationSku;
        if (itemSku && returnItemSku) return itemSku === returnItemSku;
        return Boolean(itemId && returnItemId && itemId === returnItemId);
      })
      .map((returnItem) => ({ detail, item: returnItem })),
  );
}

function refundStatusVietnamese(refund: number, fullPrice: number): string {
  if (refund <= 0) return "Không được hoàn";
  if (fullPrice > 0 && refund >= fullPrice - 1) return "Hoàn toàn bộ";
  return "Hoàn 1 phần";
}

function summarizeReturnItems(
  returnDetails: Record<string, unknown>[],
  matchedItems: Array<{ detail: Record<string, unknown>; item: Record<string, unknown> }>,
  isSku: boolean,
) {
  if (!isSku) {
    return {
      returnSn: joinReturnValues(returnDetails.map((detail) => asString(detail.return_sn))),
      status: joinReturnValues(returnDetails.map((detail) => asString(detail.status))),
      reason: joinReturnValues(
        returnDetails.map(
          (detail) => asString(detail.reassessed_request_reason) || asString(detail.reason),
        ),
      ),
      quantity: "",
      refundAmount: "",
      itemPrice: "",
    };
  }

  // Chỉ các yêu cầu hoàn/trả ở trạng thái ACCEPTED mới thực sự được hoàn tiền
  // (khớp với file Income Shopee: CANCELLED/REQUESTED/JUDGING không có refund).
  // Tiền hoàn của SKU được tính ở computeSkuRefunds (prorated từ seller_return_refund),
  // không dùng return_details.item[].refund_amount (tiền buyer thực trả, sai cho partial).
  const refundedItems = matchedItems.filter((entry) =>
    String(entry.detail.status ?? "").toUpperCase() === "ACCEPTED",
  );
  const quantity = refundedItems.reduce((sum, entry) => sum + (asNumber(entry.item.amount) ?? 0), 0);

  return {
    // return_sn/status/reason vẫn hiển thị tất cả yêu cầu hoàn (kể cả CANCELLED)
    // để đối soát, nhưng số lượng chỉ tính cho ACCEPTED.
    returnSn: joinReturnValues(matchedItems.map((entry) => asString(entry.detail.return_sn))),
    status: joinReturnValues(matchedItems.map((entry) => asString(entry.detail.status))),
    reason: joinReturnValues(
      matchedItems.map(
        (entry) => asString(entry.detail.reassessed_request_reason) || asString(entry.detail.reason),
      ),
    ),
    quantity: quantity || "",
    // refundAmount/itemPrice không còn dùng (đã thay bằng skuRefund prorated).
    refundAmount: "",
    itemPrice: "",
  };
}

function joinReturnValues(values: Array<string | undefined>) {
  return [...new Set(values.filter(Boolean))].join(", ");
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
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value * 1000));
}

function createXlsxWorkbook(
  sheetName: string,
  rows: ExportCell[][],
  options?: { definitionRows?: number; headerRows?: number },
) {
  const files = new Map<string, Uint8Array>();
  const sheetXml = buildWorksheetXml(rows, options);

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
  <fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF595959"/><name val="Calibri"/></font></fonts>
  <fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEE4D2D"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF9C27B0"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFill="1" applyFont="1"/></cellXfs>
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

function buildWorksheetXml(
  rows: ExportCell[][],
  options?: { definitionRows?: number; headerRows?: number },
) {
  const definitionRows = options?.definitionRows ?? 0;
  const headerRows = options?.headerRows ?? 1;
  const frozenRows = definitionRows + headerRows;
  const colCount = Math.max(...rows.map((row) => row.length), 1);
  const colWidth = (index: number) => (index === 6 ? 48 : index === 7 ? 22 : index >= 16 ? 18 : 16);
  const colXml = Array.from({ length: colCount }, (_, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${colWidth(index)}" customWidth="1"/>`,
  ).join("");
  const rowXml = rows
    .map((row, rowIndex) => {
      const isDefinition = rowIndex < definitionRows;
      const isHeader = !isDefinition && rowIndex < frozenRows;
      const kind: CellKind = isDefinition ? "definition" : isHeader ? "header" : "data";
      const cells = row
        .map((cell, colIndex) => worksheetCellXml(rowIndex + 1, colIndex + 1, cell, kind))
        .join("");
      // Ước lượng chiều cao dòng định nghĩa theo text dài nhất / số ký tự mỗi dòng.
      let rowAttrs = "";
      if (isDefinition) {
        const maxLen = row.reduce<number>(
          (m, cell) => Math.max(m, String(cell ?? "").length),
          0,
        );
        const lines = Math.max(1, Math.ceil(maxLen / 16));
        const height = Math.min(409, Math.max(30, lines * 15 + 4));
        rowAttrs = ` ht="${height}" customHeight="1"`;
      }
      return `<row r="${rowIndex + 1}"${rowAttrs}>${cells}</row>`;
    })
    .join("");

  // AutoFilter đặt ở dòng HEADER (dòng đầu chứa tên cột). Nếu có dòng định nghĩa
  // ở trên thì header là dòng (definitionRows + 1), ngược lại là dòng 1.
  const headerRowNumber = definitionRows + 1;
  const filterStart = headerRowNumber;
  // Freeze tất cả các dòng trên header (định nghĩa + header) để filter và định nghĩa
  // luôn hiển thị khi cuộn.
  const topLeft = `A${headerRowNumber + 1}`;
  const pane = `<pane ySplit="${headerRowNumber}" topLeftCell="${topLeft}" activePane="bottomLeft" state="frozen"/>`;

return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>
  <cols>${colXml}</cols>
  <sheetData>${rowXml}</sheetData>
  <autoFilter ref="A${filterStart}:${columnName(colCount)}${Math.max(rows.length, 1)}"/>
</worksheet>`;
}

// Các cột header nổi bật màu tím (label khớp).
const purpleHeaderLabels = new Set([
  "Doanh thu khi giao hàng",
  "Số tiền hoàn lại",
]);

type CellKind = "data" | "header" | "definition";
function worksheetCellXml(
  row: number,
  column: number,
  value: ExportCell,
  kind: CellKind,
) {
  const ref = `${columnName(column)}${row}`;
  const style =
    kind === "header"
      ? purpleHeaderLabels.has(String(value ?? ""))
        ? ' s="3"'
        : ' s="1"'
      : kind === "definition"
        ? ' s="2"'
        : "";
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
    <section className="overflow-hidden rounded-lg border border-border">
      <h4 className="border-b border-border bg-hover px-4 py-3 text-sm font-semibold text-secondary">
        {title}
      </h4>
      <pre className="max-h-[520px] overflow-auto bg-code-bg p-4 text-xs leading-relaxed text-code-text">
        {JSON.stringify(data, null, 2)}
      </pre>
    </section>
  );
}

export default App;
