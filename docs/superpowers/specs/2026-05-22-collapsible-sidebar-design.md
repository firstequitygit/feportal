# Collapsible PortalShell Sidebar - Design

Date: 2026-05-22
Status: Approved (brainstorm gate passed)
Scope: `src/components/portal-shell.tsx` only. No page, route, or auth changes.

## Goal

Make the left navigation column collapsible. Collapsed, it shows icons only.
Hovering the collapsed rail expands it as a floating overlay **over** the page
content (content does not reflow). Users can "pin" the sidebar open, which looks
exactly like today. The chosen state is remembered across sessions.

## States (desktop, `md+` only)

Mobile (`< md`) is unchanged: the hamburger drawer slides the full `w-60`
sidebar in/out exactly as it does today. Collapse is a desktop affordance.

| State | Rail width | Content offset (`main`) | Trigger |
|---|---|---|---|
| Pinned (today's look) | `w-60` (240px) | `md:ml-60` | user clicks pin toggle |
| Collapsed | `w-16` (64px), icons only | `md:ml-16` | user clicks pin toggle to unpin |
| Hover-expanded | animates to `w-60`, floats over content with `shadow-xl` | stays `md:ml-16` | mouse-enter or keyboard `focus-within` on the collapsed rail |

### Key mechanic

`<aside>` is already `position: fixed`, so it is out of normal flow. When it
grows on hover it overlays the content; `<main>`'s left margin is driven by the
**pinned** state, not the hover state, so hovering never shifts content. Only
pinning reflows the page.

## State model

- `pinned: boolean` - persisted to `localStorage` key `sidebar:pinned`
  (mirrors the existing DataGrid `localStorage` persistence pattern). Read on
  mount via `useEffect` (not lazy init - `localStorage` is unavailable during
  SSR). First-ever load defaults to `true` (pinned = current look) so existing
  users see no change.
- `hovered: boolean` - transient. Set on `onMouseEnter` / `onMouseLeave` and
  reflected by `focus-within` for keyboard users. Only meaningful when not pinned.
- `expanded = pinned || hovered` - derived; controls width and label visibility
  at `md+`.
- `open: boolean` - existing mobile drawer state, left fully independent.

## Layout / class strategy

All collapse classes are `md:`-scoped so mobile behavior is untouched.

- `<aside>`:
  - base: `fixed inset-y-0 left-0 z-30 bg-white border-r border-gray-200 flex flex-col transition-all duration-200 ease-in-out`
  - mobile width stays `w-60`; mobile translate stays `${open ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`
  - desktop width: `${expanded ? 'md:w-60' : 'md:w-16'}`
  - lift when hover-expanded (collapsed + hovered, not pinned): `md:shadow-xl`
- `<main>`: `${pinned ? 'md:ml-60' : 'md:ml-16'}` plus `transition-all duration-200`.
- Nav `Link`: keep icon always; wrap the label so it hides when collapsed at
  `md+` but always shows on mobile: label span gets `${!expanded ? 'md:hidden' : ''}`.
  Center the icon when collapsed: `${!expanded ? 'md:justify-center md:px-0' : ''}`.
- Avatar block: initials circle always visible; name/role text hidden via
  `${!expanded ? 'md:hidden' : ''}`; center the circle when collapsed.

## Pin control

A small pin toggle at the very top of the sidebar (lucide `Pin` when collapsed,
`PinOff` when pinned). `aria-label`: "Pin sidebar open" / "Collapse sidebar".
Centered in the collapsed rail and present in the hover overlay, so the user can
pin from any state. Clicking toggles `pinned` and writes `localStorage`.

## Footer action buttons

The footer holds `SyncButton`, `AirtableSyncButton`, `InviteBorrower`,
`InviteBroker`, and Sign out - labeled buttons, not plain nav links. Per the
chosen "icons in rail, full on hover" behavior:

- The footer container clips overflow (`overflow-hidden`, `whitespace-nowrap`)
  so at the `w-16` rail width only each button's leading icon shows; at full
  width the labels return.
- During planning/execution, verify each of those four button components leads
  with an icon. If one is text-only, add a leading icon (small, local edit to
  that component). Sign out already leads with the `LogOut` icon.

## No tooltip library

Hovering the collapsed rail expands it and reveals the real labels, so per-icon
tooltips are redundant. No new dependency.

## Accessibility

- `focus-within` expands the rail so keyboard navigation reveals labels.
- Pin toggle has descriptive `aria-label` reflecting current state.
- Icons retain their `Link`/`button` semantics; nav remains reachable when collapsed.

## Out of scope

- Mobile drawer behavior (unchanged).
- Any per-role nav content, auth, or routing logic (untouched).
- Animating individual icons or adding a tooltip system.

## Verification plan

- `npm run build` (TypeScript + ESLint) must pass.
- Playwright walkthrough at `md+`: collapse, hover-expand overlay floats over
  content without reflow, pin restores full layout, reload persists last state.
- Spot-check one role at mobile width to confirm the hamburger drawer is intact.
- No role-gate skill needed: no auth/route/page files change.
