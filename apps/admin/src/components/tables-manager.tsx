'use client'

import { isApiError } from '@tablex/api-client'
import type { TableInfo, TableQR } from '@tablex/shared'
import { Base64Image, cn, EmptyState, ErrorState, Spinner } from '@tablex/ui'
import { useCallback, useEffect, useState } from 'react'
import { useAuth, useRequireAuth } from '@/components/auth-provider'
import { PageHeader } from '@/components/page-header'
import { QRPrintSheet } from '@/components/qr-print-sheet'
import { api } from '@/lib/api'

export function TablesManager() {
  const auth = useRequireAuth()
  const { getToken } = useAuth()

  const [tables, setTables] = useState<TableInfo[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [qr, setQr] = useState<TableQR | null>(null)
  const [printing, setPrinting] = useState(false)

  const [newLabel, setNewLabel] = useState('')
  const [bulk, setBulk] = useState({ prefix: '', from: '1', to: '10' })
  const [showBulk, setShowBulk] = useState(false)

  const canEdit = auth?.staff.role === 'owner' || auth?.staff.role === 'manager'

  const load = useCallback(() => {
    getToken().then((token) => {
      if (!token) return
      api
        .listTables(token)
        .then((result) => {
          setTables(result.tables)
          setError(null)
        })
        .catch(setError)
    })
  }, [getToken])

  useEffect(() => {
    load()
  }, [load])

  const withToken = useCallback(
    (work: (token: string) => Promise<unknown>, failure: string) => {
      setBusy(true)
      setNotice(null)
      getToken().then((token) => {
        if (!token) {
          setBusy(false)
          return
        }
        work(token)
          .then(() => {
            setBusy(false)
            load()
          })
          .catch((err: unknown) => {
            setBusy(false)
            setNotice(isApiError(err) ? err.message : failure)
          })
      })
    },
    [getToken, load],
  )

  const showQR = useCallback(
    (table: TableInfo) => {
      getToken().then((token) => {
        if (!token) return
        api
          .getTableQR(token, table.uid, 512)
          .then(setQr)
          .catch((err: unknown) =>
            setNotice(isApiError(err) ? err.message : 'Could not render the QR code.'),
          )
      })
    },
    [getToken],
  )

  const rotateQR = useCallback(
    (table: TableInfo) => {
      /**
       * A hard confirmation, because this is destructive to a PHYSICAL object. Rotating
       * invalidates the sticker already on the table, and a diner scanning the old one gets a
       * dead end until it is reprinted (docs/DECISIONS.md D4). The wording says so rather than
       * asking a vague "are you sure?".
       */
      const confirmed = window.confirm(
        `Rotate the QR code for Table ${table.label}?\n\n` +
          'The printed code on that table will STOP WORKING immediately and must be reprinted. ' +
          'Do this only if the old code has leaked or been misused.',
      )
      if (!confirmed) return

      getToken().then((token) => {
        if (!token) return
        api
          .rotateTableQR(token, table.uid)
          .then((fresh) => {
            setQr(fresh)
            setNotice(`Table ${table.label}'s QR was rotated — reprint and replace it.`)
            load()
          })
          .catch((err: unknown) =>
            setNotice(isApiError(err) ? err.message : 'Could not rotate the QR code.'),
          )
      })
    },
    [getToken, load],
  )

  if (auth === null) return null

  if (printing && tables !== null) {
    return <QRPrintSheet tables={tables} onClose={() => setPrinting(false)} />
  }

  return (
    <>
      <PageHeader
        title="Tables"
        subtitle={canEdit ? undefined : 'Read only'}
        right={
          tables && tables.length > 0 ? (
            <button
              type="button"
              onClick={() => setPrinting(true)}
              className="min-h-tap rounded-card border border-line px-3 text-sm font-medium"
            >
              Print QR sheet
            </button>
          ) : null
        }
      />

      {notice !== null ? (
        <p
          role="status"
          className="border-b border-line bg-accent-soft px-4 py-2 text-sm text-accent"
        >
          {notice}
        </p>
      ) : null}

      <main className="grid gap-4 p-4 lg:grid-cols-3">
        <section className="lg:col-span-2">
          {error !== null ? (
            <ErrorState
              message={isApiError(error) ? error.message : 'Could not load tables.'}
              {...(isApiError(error) && error.code ? { code: error.code } : {})}
              onRetry={load}
            />
          ) : tables === null ? (
            <div className="flex items-center justify-center gap-2 py-20 text-muted">
              <Spinner /> Loading tables
            </div>
          ) : tables.length === 0 ? (
            <EmptyState
              title="No tables yet"
              description="Add your floor to start taking orders."
            />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {tables.map((table) => (
                <li
                  key={table.uid}
                  className={cn(
                    'flex items-center gap-3 rounded-card border bg-surface p-3',
                    table.status === 'active' ? 'border-line' : 'border-line opacity-60',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">Table {table.label}</p>
                    <p className="text-xs text-muted">
                      {table.seats ? `${table.seats} seats · ` : ''}
                      {table.status}
                      {table.live_order_count > 0 ? (
                        <span className="ml-1 font-medium text-accent">
                          · {table.live_order_count} live
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => showQR(table)}
                    className="min-h-tap shrink-0 rounded-card border border-line px-3 text-xs font-medium"
                  >
                    QR
                  </button>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => rotateQR(table)}
                      className="min-h-tap shrink-0 rounded-card border border-danger px-3 text-xs font-medium text-danger"
                    >
                      Rotate
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-4">
          {canEdit ? (
            <div className="rounded-card border border-line bg-surface p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Add a table
              </h2>
              <div className="mt-2 flex gap-2">
                <input
                  value={newLabel}
                  maxLength={32}
                  onChange={(event) => setNewLabel(event.target.value)}
                  placeholder="Label, e.g. 12 or Patio 2"
                  className="min-h-tap min-w-0 flex-1 rounded-card border border-line bg-bg px-3 text-sm outline-none focus:border-accent"
                />
                <button
                  type="button"
                  disabled={busy || newLabel.trim() === ''}
                  onClick={() =>
                    withToken(
                      (token) =>
                        api
                          .createTable(token, { label: newLabel.trim() })
                          .then(() => setNewLabel('')),
                      'Could not add the table.',
                    )
                  }
                  className="min-h-tap shrink-0 rounded-card bg-accent px-3 text-sm font-semibold text-accent-ink disabled:opacity-40"
                >
                  Add
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowBulk((v) => !v)}
                className="mt-3 text-xs font-medium text-accent underline"
              >
                {showBulk ? 'Hide bulk add' : 'Add a numbered range instead'}
              </button>

              {showBulk ? (
                <div className="mt-2 space-y-2">
                  {/* Onboarding a thirty-table restaurant should be one form, not thirty clicks. */}
                  <div className="grid grid-cols-3 gap-2">
                    <label className="block">
                      <span className="text-xs text-muted">Prefix</span>
                      <input
                        value={bulk.prefix}
                        maxLength={16}
                        onChange={(event) => setBulk({ ...bulk, prefix: event.target.value })}
                        placeholder="T-"
                        className="mt-1 min-h-tap w-full rounded-card border border-line bg-bg px-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-muted">From</span>
                      <input
                        value={bulk.from}
                        inputMode="numeric"
                        onChange={(event) =>
                          setBulk({
                            ...bulk,
                            from: event.target.value.replace(/\D/g, '').slice(0, 3),
                          })
                        }
                        className="mt-1 min-h-tap w-full rounded-card border border-line bg-bg px-2 text-sm tabular-nums"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-muted">To</span>
                      <input
                        value={bulk.to}
                        inputMode="numeric"
                        onChange={(event) =>
                          setBulk({
                            ...bulk,
                            to: event.target.value.replace(/\D/g, '').slice(0, 3),
                          })
                        }
                        className="mt-1 min-h-tap w-full rounded-card border border-line bg-bg px-2 text-sm tabular-nums"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      withToken(
                        (token) =>
                          api.bulkCreateTables(token, {
                            ...(bulk.prefix ? { prefix: bulk.prefix } : {}),
                            from: Number.parseInt(bulk.from || '1', 10),
                            to: Number.parseInt(bulk.to || '1', 10),
                          }),
                        'Could not add the tables.',
                      )
                    }
                    className="min-h-tap w-full rounded-card bg-accent text-sm font-semibold text-accent-ink disabled:opacity-40"
                  >
                    Add range
                  </button>
                  <p className="text-xs text-muted">
                    If any label already exists, nothing is created — so you can fix the range and
                    try again without ending up with a half-finished floor.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {qr !== null ? (
            <div className="rounded-card border border-line bg-surface p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Table {qr.label}
              </h2>
              {qr.png_base64 ? (
                <Base64Image
                  png={qr.png_base64}
                  alt={`QR code for table ${qr.label}`}
                  size={220}
                  className="mt-2 rounded p-2"
                />
              ) : null}
              <p className="mt-2 break-all text-xs text-muted">{qr.qr_url}</p>
              <div className="mt-2 flex gap-2">
                {qr.png_base64 ? (
                  <a
                    href={`data:image/png;base64,${qr.png_base64}`}
                    download={`table-${qr.label}-qr.png`}
                    className="min-h-tap flex-1 rounded-card border border-line px-3 text-center text-xs font-medium leading-[2.5rem]"
                  >
                    Download PNG
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => setQr(null)}
                  className="min-h-tap rounded-card border border-line px-3 text-xs font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          ) : null}
        </aside>
      </main>
    </>
  )
}
