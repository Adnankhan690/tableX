'use client'

import { isApiError } from '@tablex/api-client'
import type { StaffMember, StaffRole } from '@tablex/shared'
import { cn, ErrorState } from '@tablex/ui'
import { useCallback, useEffect, useState } from 'react'
import { useAuth, useRequireAuth } from '@/components/auth-provider'
import { PageHeader } from '@/components/page-header'
import { Select, type SelectOption } from '@/components/select'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardSection,
  Field,
  Input,
  Notice,
  Skeleton,
} from '@/components/ui'
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
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  /**
   * Which row is mid-request, not merely whether one is.
   *
   * A page-wide boolean disabled all three role selects, all three status buttons, Create account
   * and Update password at once, so changing one person's role greyed out the whole page. `'new'`
   * and `'password'` cover the two panels that are not a row.
   */
  const [pendingUid, setPendingUid] = useState<string | null>(null)

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
    (
      key: string,
      work: (token: string) => Promise<unknown>,
      failure: string,
      after?: () => void,
    ) => {
      setPendingUid(key)
      setNotice(null)
      getToken().then((token) => {
        if (!token) {
          setPendingUid(null)
          return
        }
        work(token)
          .then(() => {
            setPendingUid(null)
            after?.()
            load()
          })
          .catch((err: unknown) => {
            setPendingUid(null)
            /**
             * The server refuses to demote or deactivate the last active owner -- that would lock
             * everyone out of staff management with no way back short of database access. Its
             * message is surfaced as-is rather than duplicated as a client-side rule, so there is
             * one place that knows the owner count.
             */
            setNotice({ tone: 'danger', text: isApiError(err) ? err.message : failure })
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
        subtitle={
          isOwner
            ? `${staff?.length ?? 0} ${staff?.length === 1 ? 'account' : 'accounts'}`
            : 'Only owners can add or change staff'
        }
        actions={
          isOwner ? (
            <Button
              variant={showAdd ? 'secondary' : 'primary'}
              onClick={() => setShowAdd((v) => !v)}
            >
              {showAdd ? 'Close' : 'Add staff'}
            </Button>
          ) : null
        }
      />

      {notice !== null ? (
        <div className="border-b border-line bg-surface px-4 py-2.5">
          <Notice tone={notice.tone}>{notice.text}</Notice>
        </div>
      ) : null}

      <main className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-3">
        <section className="lg:col-span-2">
          {error !== null ? (
            <ErrorState
              message={isApiError(error) ? error.message : 'Could not load staff.'}
              onRetry={load}
            />
          ) : staff === null ? (
            <Card flush>
              {[0, 1, 2].map((i) => (
                <CardSection key={i} className="flex items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-2.5 w-48" />
                  </div>
                  <Skeleton className="h-tap w-32" />
                </CardSection>
              ))}
            </Card>
          ) : (
            /* One ruled list, not three floating cards. Three people are one list; rendering each
               as its own bordered box made the page read as three unrelated objects. */
            <Card flush>
              <ul>
                {staff.map((member) => {
                  const self = member.uid === auth.staff.uid
                  const rowBusy = pendingUid === member.uid
                  return (
                    <li
                      key={member.uid}
                      className="flex flex-wrap items-center gap-3 border-t border-divider px-4 py-3 first:border-t-0"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                          member.status === 'active'
                            ? 'bg-accent-soft text-accent'
                            : 'bg-surface-sunken text-muted',
                        )}
                      >
                        {member.name.slice(0, 1).toUpperCase()}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-base font-medium">
                          <span className="truncate">{member.name}</span>
                          {self ? <Badge tone="accent">You</Badge> : null}
                          {member.status !== 'active' ? (
                            <Badge tone="neutral">Deactivated</Badge>
                          ) : null}
                        </p>
                        <p className="truncate text-sm text-muted">{member.email}</p>
                      </div>

                      {isOwner ? (
                        <Select
                          value={member.role}
                          disabled={rowBusy || self}
                          onChange={(role) =>
                            run(
                              member.uid,
                              (token) => api.updateStaff(token, member.uid, { role }),
                              'Could not change the role.',
                              () =>
                                setNotice({
                                  tone: 'success',
                                  // Silence used to be the only feedback for a role change, which
                                  // is the one action here that grants access.
                                  text: `${member.name} is now ${ROLE_LABEL[role].toLowerCase()}.`,
                                }),
                            )
                          }
                          options={ROLE_OPTIONS}
                          ariaLabel={`Role for ${member.name}`}
                          className="w-[9rem] shrink-0"
                        />
                      ) : (
                        <Badge tone="neutral">{ROLE_LABEL[member.role]}</Badge>
                      )}

                      {isOwner ? (
                        <Button
                          size="sm"
                          variant={member.status === 'active' ? 'danger-quiet' : 'secondary'}
                          // Disabled on your own row with the reason on the control, rather than
                          // letting a manager discover it from a server error: locking yourself out
                          // of staff management needs database access to undo.
                          disabled={rowBusy || self}
                          title={self ? 'You cannot deactivate your own account' : undefined}
                          loading={rowBusy}
                          onClick={() =>
                            run(
                              member.uid,
                              (token) =>
                                api.updateStaff(token, member.uid, {
                                  status: member.status === 'active' ? 'inactive' : 'active',
                                }),
                              'Could not change the account status.',
                              () =>
                                setNotice({
                                  tone: 'success',
                                  text:
                                    member.status === 'active'
                                      ? `${member.name} can no longer sign in.`
                                      : `${member.name} can sign in again.`,
                                }),
                            )
                          }
                        >
                          {member.status === 'active' ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}
        </section>

        <aside className="space-y-4">
          {isOwner && showAdd ? (
            <Card className="space-y-3">
              <CardHeader
                title="New staff"
                description="They can sign in as soon as you create it."
              />
              <Field label="Name">
                {({ id }) => (
                  <Input
                    id={id}
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Email">
                {({ id }) => (
                  <Input
                    id={id}
                    type="email"
                    autoComplete="off"
                    value={draft.email}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  />
                )}
              </Field>
              <Field
                label="Password"
                hint="At least 8 characters. Share it with them directly and ask them to change it."
              >
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    type="password"
                    autoComplete="new-password"
                    value={draft.password}
                    onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                  />
                )}
              </Field>
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
                <span className="mt-1.5 block text-xs text-muted">
                  {ROLE_DESCRIPTION[draft.role]}
                </span>
              </div>
              <Button
                variant="primary"
                block
                disabled={draft.password.length < 8 || draft.email.trim() === ''}
                loading={pendingUid === 'new'}
                loadingLabel="Creating…"
                onClick={() =>
                  run(
                    'new',
                    (token) =>
                      api.createStaff(token, {
                        name: draft.name.trim(),
                        email: draft.email.trim(),
                        password: draft.password,
                        role: draft.role,
                      }),
                    'Could not add the staff member.',
                    () => {
                      setDraft({ name: '', email: '', password: '', role: 'staff' })
                      setShowAdd(false)
                      setNotice({ tone: 'success', text: 'Account created.' })
                    },
                  )
                }
              >
                Create account
              </Button>
            </Card>
          ) : null}

          <Card className="space-y-3">
            <CardHeader title="Your password" description="Changing it does not sign you out." />
            <Field label="Current password">
              {({ id }) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="current-password"
                  value={pw.current}
                  onChange={(e) => setPw({ ...pw, current: e.target.value })}
                />
              )}
            </Field>
            <Field label="New password" hint="At least 8 characters.">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="password"
                  autoComplete="new-password"
                  value={pw.next}
                  onChange={(e) => setPw({ ...pw, next: e.target.value })}
                />
              )}
            </Field>
            <Button
              block
              disabled={pw.next.length < 8 || pw.current === ''}
              loading={pendingUid === 'password'}
              loadingLabel="Updating…"
              onClick={() =>
                run(
                  'password',
                  (token) =>
                    api.changePassword(token, {
                      current_password: pw.current,
                      new_password: pw.next,
                    }),
                  'Could not change your password.',
                  () => {
                    setPw({ current: '', next: '' })
                    setNotice({ tone: 'success', text: 'Password changed.' })
                  },
                )
              }
            >
              Update password
            </Button>
          </Card>
        </aside>
      </main>
    </>
  )
}
