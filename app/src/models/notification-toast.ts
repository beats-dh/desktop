/**
 * A transient floating notification rendered as a toast in the corner of the
 * window. Independent from `Banner` (which is a persistent inline strip) so
 * the two can coexist — banners stay for things like "Update available", while
 * toasts mirror Alive notifications.
 */
export interface INotificationToast {
  /**
   * Stable id used by React keys and by the dismiss handler. Caller doesn't
   * need to provide one — the store generates it on push.
   */
  readonly id: string

  /** Bold first line of the toast. */
  readonly title: string

  /** Secondary text below the title. Multi-line allowed; will be clamped. */
  readonly body: string

  /**
   * Triggered when the user clicks the toast's primary action. Usually opens
   * the relevant view and dismisses the toast.
   */
  readonly onClick: () => void
}
