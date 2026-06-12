---
name: Orval hooks need explicit queryKey when overriding query options
description: Passing a `query` options object (e.g. {enabled}) to a generated useX hook makes queryKey required (TS2741) — pass getXQueryKey().
---

When you call an Orval-generated React Query hook (e.g. `useListVenues`,
`useListFindPlayerPosts`) and pass a `query` options object, the generated
overload makes `queryKey` **required** — `useX({ query: { enabled } })` fails
with `TS2741: Property 'queryKey' is missing`.

**Fix:** pass the generated key alongside your options:
`useX({ query: { enabled, queryKey: getXQueryKey(params) } })`.

**Why:** the codegen config types the `query` override as the full
`UseQueryOptions` (which requires `queryKey`) rather than a partial — so the moment
you supply ANY query option you must also supply the key. Omitting `query`
entirely is fine (the hook fills the key itself); the requirement only kicks in
once you override.

**How to apply:** any time you need `enabled`, `refetchInterval`, `staleTime`,
etc. on a generated hook, import and pass `getXQueryKey()` from
`@workspace/api-client-react`. This recurs across the codebase (FindPlayers,
AdminVenues, etc.).
