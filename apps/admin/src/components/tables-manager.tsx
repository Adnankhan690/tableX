'use client'

import { isApiError } from '@tablex/api-client'
import type { TableInfo, TableQR } from '@tablex/shared'
import { Base64Image, cn, ErrorState } from '@tablex/ui'
import { useCallback, useEffect, useId, useState } from 'react'
import { useAuth, useRequireAuth } from '@/components/auth-provider'
import { PageHeader } from '@/components/page-header'
import { QRPrintSheet } from '@/components/qr-print-sheet'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Field,
  Input,
  Notice,
  Skeleton,
} from '@/components/ui'
import { api } from '@/lib/api'

/**
 * How a table's label reads in a sentence.
 *
 * Prefixing "Table " unconditionally printed "Table Patio 1" -- the label is a name when it is not
 * a number, and the prefix is only there so a bare "7" has something to hold on to. Six sites
 * concatenated it by hand, which is why they disagreed.
 */
export function tableTitle(label: string): string {
  return /^\d+$/.test(label) ? `Table ${label}` : label
}

export function TablesManager() {
  const auth = useRequireAuth()
  const { getToken } = useAuth()

  const [tables, setTables] = useState<TableInfo[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<{
    tone: 'success' | 'warning' | 'danger'
    text: string
  } | null>(null)
  /** The table awaiting a rotate confirmation, or null. */
  const [rotating, setRotating] = useState<TableInfo | null>(null)
  /** The QR panel's id, so showQR can scroll it into view once it mounts. */
  const qrPanelId = useId()
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
            setNotice({ tone: 'danger', text: isApiError(err) ? err.message : failure })
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
          .then((fresh) => {
            setQr(fresh)
            /*
              Bring the panel to the user.

              At tablet width this aside stacks BELOW the entire card list, so tapping "Show QR" on
              the last table mounted a panel a screen and a half away with no scroll and no focus
              move: the button appeared to do nothing, and staff tapped it repeatedly. The frame
              delay is for the panel to exist before we look for it.
            */
            requestAnimationFrame(() => {
              const panel = document.getElementById(qrPanelId)
              panel?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
            })
          })
          .catch((err: unknown) =>
            setNotice({
              tone: 'danger',
              text: isApiError(err) ? err.message : 'Could not render the QR code.',
            }),
          )
      })
    },
    [getToken, qrPanelId],
  )

  /**
   * Rotation confirms in the app's own dialog, not window.confirm().
   *
   * Still a hard confirmation, because this is destructive to a PHYSICAL object: rotating
   * invalidates the sticker already on the table, and a diner scanning the old one gets a dead end
   * until it is reprinted (docs/DECISIONS.md D4). But a browser confirm() renders in the OS chrome
   * -- unstyled, untranslatable, and on a kitchen tablet indistinguishable from a system error --
   * for the one action here that costs someone a trip to the printer.
   */
  const rotateQR = useCallback(
    (table: TableInfo) => {
      getToken().then((token) => {
        if (!token) return
        api
          .rotateTableQR(token, table.uid)
          .then((fresh) => {
            setQr(fresh)
            setNotice({
              tone: 'warning',
              text: `${tableTitle(table.label)}'s QR was rotated — reprint and replace it.`,
            })
            load()
          })
          .catch((err: unknown) =>
            setNotice({
              tone: 'danger',
              text: isApiError(err) ? err.message : 'Could not rotate the QR code.',
            }),
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
        subtitle={
          tables && tables.length > 0
            ? `${tables.length} ${tables.length === 1 ? 'table' : 'tables'}${
                canEdit ? '' : ' · read only'
              }`
            : canEdit
              ? undefined
              : 'Read only'
        }
        actions={
          tables && tables.length > 0 ? (
            <Button
              onClick={() => setPrinting(true)}
              icon={
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  className="h-4 w-4"
                >
                  <path d="M6 7V3.5h8V7M6 15.5h8V18H6z" strokeWidth="1.5" strokeLinejoin="round" />
                  <rect x="3.5" y="7" width="13" height="8.5" rx="1.5" strokeWidth="1.5" />
                </svg>
              }
            >
              Print QR sheet
            </Button>
          ) : null
        }
      />

      {notice !== null ? (
        <div className="border-b border-line bg-surface px-4 py-2.5">
          <Notice tone={notice.tone}>{notice.text}</Notice>
        </div>
      ) : null}

      <main className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0">
          {error !== null ? (
            <ErrorState
              message={isApiError(error) ? error.message : 'Could not load tables.'}
              {...(isApiError(error) && error.code ? { code: error.code } : {})}
              onRetry={load}
            />
          ) : tables === null ? (
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <li key={i}>
                  <Skeleton className="h-[4.5rem] w-full" />
                </li>
              ))}
            </ul>
          ) : tables.length === 0 ? (
            <EmptyState
              title="No tables yet"
              description="Add your floor to start taking orders. Each table gets its own QR code."
              icon={
                <>
                  <rect x="3" y="4" width="14" height="6" rx="1.5" strokeWidth="1.5" />
                  <path d="M6.5 10v6M13.5 10v6" strokeWidth="1.5" strokeLinecap="round" />
                </>
              }
            />
          ) : (
            /* The grid grows with the viewport instead of being capped inside a two-thirds column:
               eight cards used to sit in the top 400px of a 1900px screen with the rest empty. */
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {tables.map((table) => {
                const selected = qr?.table_uid === table.uid
                return (
                  <li key={table.uid}>
                    <Card
                      flush
                      className={cn(
                        'flex h-full flex-col justify-between gap-2 p-3 transition-colors',
                        selected ? 'border-accent-line bg-accent-soft' : '',
                        table.status !== 'active' ? 'opacity-70' : '',
                      )}
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-base font-semibold">
                          <span className="truncate">{tableTitle(table.label)}</span>
                          {table.live_order_count > 0 ? (
                            <Badge tone="accent">{table.live_order_count} live</Badge>
                          ) : null}
                          {table.status !== 'active' ? (
                            <Badge tone="neutral">Inactive</Badge>
                          ) : null}
                        </p>
                        <p className="text-sm text-muted">
                          {table.seats ? `${table.seats} seats` : 'Seats not set'}
                        </p>
                      </div>

                      {/* ONE action in the card's resting state. Rotate was a red-outlined button
                          on every card -- eight reds in a 2x4 grid, for the rarest action on the
                          page -- so it now lives inside the QR panel, where the code being
                          replaced is on screen. */}
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant={selected ? 'primary' : 'secondary'}
                          aria-pressed={selected}
                          onClick={() => (selected ? setQr(null) : showQR(table))}
                          icon={
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 20 20"
                              fill="none"
                              stroke="currentColor"
                              className="h-4 w-4"
                            >
                              <rect x="3" y="3" width="5.5" height="5.5" rx="1" strokeWidth="1.5" />
                              <rect
                                x="11.5"
                                y="3"
                                width="5.5"
                                height="5.5"
                                rx="1"
                                strokeWidth="1.5"
                              />
                              <rect
                                x="3"
                                y="11.5"
                                width="5.5"
                                height="5.5"
                                rx="1"
                                strokeWidth="1.5"
                              />
                              <path d="M11.5 11.5h2v2h-2zM15 15h2v2h-2z" strokeWidth="1.5" />
                            </svg>
                          }
                        >
                          {selected ? 'Hide QR' : 'Show QR'}
                        </Button>
                      </div>
                    </Card>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <aside className="space-y-4">
          {/*
            The QR panel. Announced when it opens: at tablet width this column stacks BELOW the
            whole card list, so tapping "Show QR" on table 7 used to mount a panel off-screen with
            no scroll, no focus move and no mark on the card that was tapped -- the button appeared
            to do nothing.
          */}
          {qr !== null ? (
            <Card id={qrPanelId} className="space-y-3 animate-rise-in xl:sticky xl:top-[4.5rem]">
              <CardHeader
                title={tableTitle(qr.label)}
                description="Print this and put it on the table."
                actions={
                  <Button size="sm" variant="ghost" onClick={() => setQr(null)}>
                    Close
                  </Button>
                }
              />
              {qr.png_base64 ? (
                <Base64Image
                  png={qr.png_base64}
                  alt={`QR code for table ${qr.label}`}
                  size={220}
                  className="mx-auto rounded-card border border-line bg-surface p-2"
                />
              ) : null}
              <p className="break-all rounded-control border border-line bg-bg p-2 text-xs text-muted">
                {qr.qr_url}
              </p>
              <div className="flex flex-col gap-2">
                {qr.png_base64 ? (
                  <a
                    href={`data:image/png;base64,${qr.png_base64}`}
                    download={`table-${qr.label}-qr.png`}
                    className="inline-flex min-h-tap items-center justify-center gap-1.5 rounded-control border border-line-strong bg-surface px-3.5 text-base font-medium transition-colors hover:bg-surface-sunken"
                  >
                    Download PNG
                  </a>
                ) : null}
                {canEdit ? (
                  <Button
                    variant="danger-quiet"
                    onClick={() => {
                      const table = tables?.find((t) => t.uid === qr.table_uid)
                      if (table) setRotating(table)
                    }}
                  >
                    Replace this code…
                  </Button>
                ) : null}
              </div>
            </Card>
          ) : null}

          {canEdit ? (
            <Card className="space-y-3">
              <CardHeader title="Add a table" />
              <div className="flex items-end gap-2">
                <Field label="Label" className="flex-1">
                  {({ id }) => (
                    <Input
                      id={id}
                      value={newLabel}
                      maxLength={32}
                      onChange={(event) => setNewLabel(event.target.value)}
                      placeholder="12, or Patio 2"
                    />
                  )}
                </Field>
                <Button
                  variant="primary"
                  disabled={newLabel.trim() === ''}
                  loading={busy}
                  loadingLabel="Adding…"
                  onClick={() =>
                    withToken(
                      (token) =>
                        api
                          .createTable(token, { label: newLabel.trim() })
                          .then(() => setNewLabel('')),
                      'Could not add the table.',
                    )
                  }
                >
                  Add
                </Button>
              </div>

              <Button
                size="sm"
                variant="ghost"
                className="-ml-2.5"
                onClick={() => setShowBulk((v) => !v)}
              >
                {showBulk ? 'Hide bulk add' : 'Add a numbered range instead'}
              </Button>

              {showBulk ? (
                <div className="space-y-3 border-t border-divider pt-3">
                  {/* Onboarding a thirty-table restaurant should be one form, not thirty clicks. */}
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Prefix">
                      {({ id }) => (
                        <Input
                          id={id}
                          value={bulk.prefix}
                          maxLength={16}
                          onChange={(event) => setBulk({ ...bulk, prefix: event.target.value })}
                          placeholder="T-"
                        />
                      )}
                    </Field>
                    <Field label="From">
                      {({ id }) => (
                        <Input
                          id={id}
                          value={bulk.from}
                          inputMode="numeric"
                          numeric
                          onChange={(event) =>
                            setBulk({
                              ...bulk,
                              from: event.target.value.replace(/\D/g, '').slice(0, 3),
                            })
                          }
                        />
                      )}
                    </Field>
                    <Field label="To">
                      {({ id }) => (
                        <Input
                          id={id}
                          value={bulk.to}
                          inputMode="numeric"
                          numeric
                          onChange={(event) =>
                            setBulk({
                              ...bulk,
                              to: event.target.value.replace(/\D/g, '').slice(0, 3),
                            })
                          }
                        />
                      )}
                    </Field>
                  </div>
                  <Button
                    variant="primary"
                    block
                    loading={busy}
                    loadingLabel="Adding…"
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
                  >
                    Add range
                  </Button>
                  <p className="text-xs text-muted">
                    If any label already exists, nothing is created — so you can fix the range and
                    try again without ending up with a half-finished floor.
                  </p>
                </div>
              ) : null}
            </Card>
          ) : null}
        </aside>
      </main>

      <Dialog
        open={rotating !== null}
        title={rotating ? `Replace ${tableTitle(rotating.label)}'s QR code?` : ''}
        description="The printed code on that table stops working immediately."
        onClose={() => setRotating(null)}
        footer={
          <>
            <Button onClick={() => setRotating(null)}>Keep the current code</Button>
            <Button
              variant="danger"
              onClick={() => {
                const table = rotating
                setRotating(null)
                if (table) rotateQR(table)
              }}
            >
              Replace it
            </Button>
          </>
        }
      >
        <p className="text-base text-muted">
          A diner scanning the old sticker reaches a dead end until you reprint and replace it. Do
          this only if the code has leaked or been misused.
        </p>
      </Dialog>
    </>
  )
}
