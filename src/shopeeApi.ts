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

export type OrdersProgress = {
  phase: 'income' | 'orders' | 'detail' | 'escrow'
  loaded: number
  total: number
}

function assertConfig(config: ShopeeConfig) {
  const missing = Object.entries(config)
    .filter(([, value]) => !value.trim())
    .map(([key]) => key)

  if (missing.length > 0) {
    throw new Error(`Thiếu cấu hình: ${missing.join(', ')}`)
  }
}

// Tải đơn qua endpoint SSE /shopee/orders/stream để nhận tiến độ từng phase.
// onProgress được gọi mỗi khi worker báo phase mới (income/orders/detail/escrow).
export function streamOrdersWithEscrow(
  config: ShopeeConfig,
  range: DateRange,
  dateMode: DateMode = 'created',
  onProgress?: (progress: OrdersProgress) => void,
): Promise<OrdersResponse> {
  assertConfig(config)

  const base = config.apiBaseUrl.replace(/\/+$/, '')
  const url = new URL('/shopee/orders/stream', base)
  url.searchParams.set('shop_id', config.shopId)
  url.searchParams.set('from', range.from)
  url.searchParams.set('to', range.to)
  url.searchParams.set('date_mode', dateMode)

  return new Promise((resolve, reject) => {
    const source = new EventSource(url.toString())
    let settled = false

    const cleanup = () => {
      source.removeEventListener('progress', onProgressEvent as EventListener)
      source.removeEventListener('done', onDoneEvent as EventListener)
      source.removeEventListener('fail', onFailEvent as EventListener)
      source.removeEventListener('error', onErrorEvent as EventListener)
      source.close()
    }

    const onProgressEvent = (event: MessageEvent) => {
      try {
        onProgress?.(JSON.parse(event.data) as OrdersProgress)
      } catch {
        // ignore malformed progress
      }
    }
    const onDoneEvent = (event: MessageEvent) => {
      if (settled) return
      settled = true
      try {
        const payload = JSON.parse(event.data) as OrdersResponse
        if (!payload || !('rows' in payload) || !('columns' in payload)) {
          reject(new Error('Backend không trả về dữ liệu đơn hàng hợp lệ.'))
        } else {
          resolve(payload)
        }
      } catch {
        reject(new Error('Backend không trả về dữ liệu đơn hàng hợp lệ.'))
      } finally {
        cleanup()
      }
    }
    const onFailEvent = (event: MessageEvent) => {
      if (settled) return
      settled = true
      try {
        const payload = JSON.parse(event.data) as { message?: string }
        reject(new Error(payload?.message || 'Không tải được dữ liệu Shopee.'))
      } catch {
        reject(new Error('Không tải được dữ liệu Shopee.'))
      } finally {
        cleanup()
      }
    }
    const onErrorEvent = () => {
      if (settled) return
      // EventSource tự reconnect; nếu chưa nhận done/fail thì coi như lỗi kết nối.
      settled = true
      reject(new Error('Mất kết nối tới backend khi tải dữ liệu.'))
      cleanup()
    }

    source.addEventListener('progress', onProgressEvent as EventListener)
    source.addEventListener('done', onDoneEvent as EventListener)
    source.addEventListener('fail', onFailEvent as EventListener)
    source.addEventListener('error', onErrorEvent as EventListener)
  })
}

// Backwards-compatible fetch (không stream). Giữ lại làm fallback nếu cần.
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
