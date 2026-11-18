import type { OrderStatus } from './order.model';

/**
 * State machine trạng thái đơn (thao tác của nhân viên):
 *   pending   → confirmed | cancelled
 *   confirmed → preparing | cancelled
 *   preparing → ready
 *   ready     → served
 *   served / cancelled: trạng thái cuối.
 */
export const ORDER_STATUS_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready'],
  ready: ['served'],
  served: [],
  cancelled: [],
};

export function allowedNextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return ORDER_STATUS_TRANSITIONS[from];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

/** Thứ tự tiến trình (không gồm cancelled) — dùng để đồng bộ itemStatus theo trạng thái đơn. */
export const PROGRESS_ORDER: readonly OrderStatus[] = [
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'served',
];

export function progressRank(status: OrderStatus): number {
  return PROGRESS_ORDER.indexOf(status);
}

/** Các trạng thái đứng trước `status` trong tiến trình. */
export function statusesBefore(status: OrderStatus): OrderStatus[] {
  const rank = progressRank(status);
  return rank <= 0 ? [] : PROGRESS_ORDER.slice(0, rank);
}

/** Trạng thái món nhân viên có thể đặt qua PATCH /admin/orders/:id/items/:itemId. */
export const ITEM_UPDATABLE_STATUSES = ['preparing', 'ready', 'served', 'cancelled'] as const;
export type ItemUpdatableStatus = (typeof ITEM_UPDATABLE_STATUSES)[number];

/**
 * Món chỉ tiến lên (preparing → ready → served) hoặc bị huỷ khi chưa served.
 * Không cập nhật món đã huỷ.
 */
export function canTransitionItem(from: OrderStatus, to: ItemUpdatableStatus): boolean {
  if (from === 'cancelled' || from === 'served') return false;
  if (to === 'cancelled') return true;
  return progressRank(to) > progressRank(from);
}
