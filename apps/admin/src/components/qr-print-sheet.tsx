'use client'

import type { TableInfo, TableQR } from '@tablex/shared'
import { Base64Image, Spinner } from '@tablex/ui'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/components/auth-provider'
import { api } from '@/lib/api'

/**
 * A printable sheet of every table's QR code.
 *
 * Sized for A4 rather than US Letter: this is an Indian-market product and A4 is what the
 * restaurant's printer has paper for. Six cards per page at 9cm x 9cm leaves enough white space
 * to cut and mount them on table stands.
 *
 * Each table's QR is fetched separately, so this is one request per table. Acceptable because it
 * runs once at onboarding, not during service -- and a batch endpoint would exist only for this
 * screen.
 */
export function QRPrintSheet({ tables, onClose }: { tables: TableInfo[]; onClose: () => void }) {
  const { getToken, auth } = useAuth()
  const [codes, setCodes] = useState<TableQR[] | null>(null)
  const [failed, setFailed] = useState(0)

  const load = useCallback(() => {
    getToken().then((token) => {
      if (!token) return
      const active = tables.filter((table) => table.status === 'active')

      Promise.allSettled(active.map((table) => api.getTableQR(token, table.uid, 512))).then(
        (results) => {
          const ok: TableQR[] = []
          let bad = 0
          for (const result of results) {
            if (result.status === 'fulfilled') ok.push(result.value)
            else bad += 1
          }
          setCodes(ok)
          // Reported rather than swallowed: printing a sheet that is silently missing table 7
          // means table 7 cannot order and nobody knows why.
          setFailed(bad)
        },
      )
    })
  }, [getToken, tables])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="p-4">
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          disabled={codes === null}
          className="min-h-tap rounded-card bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40"
        >
          Print
        </button>
        <button
          type="button"
          onClick={onClose}
          className="min-h-tap rounded-card border border-line px-4 text-sm font-medium"
        >
          Back to tables
        </button>
        <p className="text-xs text-muted">
          A4, six per page. Cut along the borders and mount on your table stands.
        </p>
        {failed > 0 ? (
          <p className="text-xs font-medium text-danger">
            {failed} table{failed === 1 ? '' : 's'} could not be rendered and are missing from this
            sheet.
          </p>
        ) : null}
      </div>

      {codes === null ? (
        <div className="flex items-center justify-center gap-2 py-20 text-muted">
          <Spinner /> Rendering {tables.length} QR codes
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {codes.map((code) => (
            <figure
              key={code.table_uid}
              // break-inside-avoid keeps a card from being split across two printed pages.
              className="flex break-inside-avoid flex-col items-center gap-1 rounded-card border border-line bg-white p-3 text-center text-black"
            >
              <figcaption className="text-xs font-medium">{auth?.restaurant.name ?? ''}</figcaption>
              <p className="text-lg font-bold leading-tight">Table {code.label}</p>
              {code.png_base64 ? (
                <Base64Image
                  png={code.png_base64}
                  alt={`QR code for table ${code.label}`}
                  size={180}
                />
              ) : null}
              <p className="text-xs font-medium">Scan to see the menu and order</p>
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}
