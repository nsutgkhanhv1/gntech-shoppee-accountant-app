export type ShopeeConfig = {
  apiBaseUrl: string
  shopId: string
}

export type DateRange = {
  from: string
  to: string
}

export type DateMode = 'created' | 'paid' | 'completed'

export type ColumnDef = {
  key: string
  label: string
  type?: 'text' | 'number' | 'currency' | 'date' | 'boolean'
  align?: 'left' | 'right'
}

export type OrderRow = {
  order_sn: string
  currency?: string
  values: Record<string, unknown>
  raw_order: Record<string, unknown>
  raw_escrow: Record<string, unknown> | null
}

export type OrdersResponse = {
  columns: ColumnDef[]
  rows: OrderRow[]
}

function assertConfig(config: ShopeeConfig) {
  const missing = Object.entries(config)
    .filter(([, value]) => !value.trim())
    .map(([key]) => key)

  if (missing.length > 0) {
    throw new Error(`Thiếu cấu hình: ${missing.join(', ')}`)
  }
}

export async function fetchOrdersWithEscrow(
  config: ShopeeConfig,
  range: DateRange,
  dateMode: DateMode = 'created',
): Promise<OrdersResponse> {
  assertConfig(config)

  const url = new URL('/shopee/orders', config.apiBaseUrl.replace(/\/+$/, ''))
  url.searchParams.set('shop_id', config.shopId)
  url.searchParams.set('from', range.from)
  url.searchParams.set('to', range.to)
  url.searchParams.set('date_mode', dateMode)

  const response = await fetch(url)
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; message?: string }
    | OrdersResponse
    | null

  if (!response.ok) {
    throw new Error(
      payload && 'message' in payload && payload.message
        ? payload.message
        : `Backend lỗi HTTP ${response.status}`,
    )
  }

  if (!payload || !('rows' in payload) || !('columns' in payload)) {
    throw new Error('Backend không trả về dữ liệu đơn hàng hợp lệ.')
  }

  return payload
}
