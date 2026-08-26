'use client'

import { isApiError } from '@tablex/api-client'
import type { StaffMember, StaffRole } from '@tablex/shared'
import { cn, ErrorState, Spinner } from '@tablex/ui'
import { useCallback, useEffect, useState } from 'react'
import { useAuth, useRequireAuth } from '@/components/auth-provider'
import { PageHeader } from '@/components/page-header'
import { Select, type SelectOption } from '@/components/select'
import { api } from '@/lib/api'

const ROLES: readonly StaffRole[] = ['owner', 'manager', 'staff']

const ROLE_DESCRIPTION: Record<StaffRole, string> = {
  owner: 'Everything, including adding and removing staff.',
  manager: 'Orders, the menu, tables and settings.',
  staff: 'Orders and marking dishes sold out.',
}

/** Sentence case, because the role reads as a word in the UI and not as the API's enum value. */
const ROLE_LABEL: Record<StaffRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
}

/**
 * The role choices, with what each one can do carried on the option itself.
 *
 * The consequence of this pick is invisible from the three words alone, and it is the one field
 * on this page that grants access -- so it is spelled out where the choice is made, not only
 * under the closed control.
 */
const ROLE_OPTIONS: readonly SelectOption<StaffRole>[] = ROLES.map((role) => ({
  value: role,
  label: ROLE_LABEL[role],
  description: ROLE_DESCRIPTION[role],
}))

export function StaffManager() {
  const auth = useRequireAuth()
  const { getToken } = useAuth()

  const [staff, setStaff] = useState<StaffMember[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [draft, setDraft] = useState({
    name: '',
    email: '',
    password: '',
    role: 'staff' as StaffRole,
  })
  const [showAdd, setShowAdd] = useState(false)
  const [pw, setPw] = useState({ current: '', next: '' })

  /**
   * A UI convenience only. The server enforces owner-only on these endpoints regardless of what
   * this renders, and it is the actual boundary -- hiding a button is not access control.
   */
  const isOwner = auth?.staff.role === 'owner'

  const load = useCallback(() => {
    getToken().then((token) => {
      if (!token) return
      api
        .listStaff(token)
        .then((result) => {
          setStaff(result.staff)
          setError(null)
        })
        .catch(setError)
    })
  }, [getToken])

  useEffect(() => {
    load()
  }, [load])

  const run = useCallback(
    (work: (token: string) => Promise<unknown>, failure: string, after?: () => void) => {
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
            after?.()
            load()
          })
          .catch((err: unknown) => {
            setBusy(false)
            /**
             * The server refuses to demote or deactivate the last active owner -- that would lock
             * everyone out of staff management with no way back short of database access. Its
             * message is surfaced as-is rather than duplicated as a client-side rule, so there is
             * one place that knows the owner count.
             */
            setNotice(isApiError(err) ? err.message : failure)
          })
      })
    },
    [getToken, load],
  )

  if (auth === null) return null

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle={isOwner ? undefined : 'Only owners can add or change staff'}
        right={
          isOwner ? (
            <button
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              className="min-h-tap rounded-card bg-accent px-3 text-sm font-semibold text-accent-ink"
            >
              {showAdd ? 'Cancel' : 'Add staff'}
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
              message={isApiError(error) ? error.message : 'Could not load staff.'}
              onRetry={load}
            />
          ) : staff === null ? (
            <div className="flex items-center justify-center gap-2 py-20 text-muted">
              <Spinner /> Loading
            </div>
          ) : (
            <ul className="space-y-2">
              {staff.map((member) => (
                <li
                  key={member.uid}
                  className={cn(
                    'flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-3',
                    member.status !== 'active' && 'opacity-60',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {member.name}
                      {member.uid === auth.staff.uid ? (
                        <span className="ml-2 text-xs text-muted">(you)</span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted">{member.email}</p>
                  </div>

                  {isOwner ? (
                    <Select
                      value={member.role}
                      disabled={busy}
                      onChange={(role) =>
                        run(
                          (token) => api.updateStaff(token, member.uid, { role }),
                          'Could not change the role.',
                        )
                      }
                      options={ROLE_OPTIONS}
                      ariaLabel={`Role for ${member.name}`}
                      className="w-[8.5rem] shrink-0"
                    />
                  ) : (
                    <span className="rounded bg-surface-sunken px-2 py-0.5 text-xs">
                      {ROLE_LABEL[member.role]}
                    </span>
                  )}

                  {isOwner ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(
                          (token) =>
                            api.updateStaff(token, member.uid, {
                              status: member.status === 'active' ? 'inactive' : 'active',
                            }),
                          'Could not change the account status.',
                        )
                      }
                      className={cn(
                        'min-h-tap shrink-0 rounded-card border px-3 text-xs font-medium disabled:opacity-40',
                        member.status === 'active' ? 'border-danger text-danger' : 'border-line',
                      )}
                    >
                      {member.status === 'active' ? 'Deactivate' : 'Reactivate'}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-4">
          {isOwner && showAdd ? (
            <div className="space-y-3 rounded-card border border-line bg-surface p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                New staff
              </h2>
              <Input
                label="Name"
                value={draft.name}
                onChange={(v) => setDraft({ ...draft, name: v })}
              />
              <Input
                label="Email"
                type="email"
                value={draft.email}
                onChange={(v) => setDraft({ ...draft, email: v })}
              />
              <Input
                label="Password"
                type="password"
                value={draft.password}
                onChange={(v) => setDraft({ ...draft, password: v })}
                hint="At least 8 characters. Share it with them directly and ask them to change it."
              />
              <div>
                <Select
                  label="Role"
                  value={draft.role}
                  onChange={(role) => setDraft({ ...draft, role })}
                  options={ROLE_OPTIONS}
                  className="w-full"
                />
                {/* Repeats the selected option's description under the closed control, so the
                    grant is still on screen when the list is shut. */}
                <span className="mt-1 block text-xs text-muted">
                  {ROLE_DESCRIPTION[draft.role]}
                </span>
              </div>
              <button
                type="button"
                disabled={busy || draft.password.length < 8 || draft.email.trim() === ''}
                onClick={() =>
                  run(
                    (token) =>
                      api.createStaff(token, {
                        name: draft.name.trim(),
                        email: draft.email.trim(),
                        password: draft.password,
                        role: draft.role,
                      }),
                    'Could not add the staff member.',
                    () => {
                      setDraft({
                        name: '',
                        email: '',
                        password: '',
                        role: 'staff',
                      })
                      setShowAdd(false)
                    },
                  )
                }
                className="min-h-tap w-full rounded-card bg-accent text-sm font-semibold text-accent-ink disabled:opacity-40"
              >
                Create account
              </button>
            </div>
          ) : null}

          <div className="space-y-3 rounded-card border border-line bg-surface p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Change your password
            </h2>
            <Input
              label="Current password"
              type="password"
              value={pw.current}
              onChange={(v) => setPw({ ...pw, current: v })}
            />
            <Input
              label="New password"
              type="password"
              value={pw.next}
              onChange={(v) => setPw({ ...pw, next: v })}
              hint="At least 8 characters."
            />
            <button
              type="button"
              disabled={busy || pw.next.length < 8 || pw.current === ''}
              onClick={() =>
                run(
                  (token) =>
                    api.changePassword(token, {
                      current_password: pw.current,
                      new_password: pw.next,
                    }),
                  'Could not change your password.',
                  () => {
                    setPw({ current: '', next: '' })
                    setNotice('Password changed.')
                  },
                )
              }
              className="min-h-tap w-full rounded-card border border-line text-sm font-semibold disabled:opacity-40"
            >
              Update password
            </button>
          </div>
        </aside>
      </main>
    </>
  )
}

function Input({
  label,
  value,
  onChange,
  type = 'text',
  hint,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'email' | 'password'
  hint?: string
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={type === 'password' ? 'new-password' : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-h-tap w-full rounded-card border border-line bg-bg px-3 text-sm outline-none focus:border-accent"
      />
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  )
}
