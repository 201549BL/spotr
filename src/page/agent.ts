// Runs INSIDE Spotify's page. CdpBridge sends `installAgent.toString()`,
// so the function body must be self-contained: no imports and no
// references to anything outside it. Types are fine; they are erased.

declare const opaque: unique symbol

// Values owned by Spotify that the agent passes along without inspecting.
type ModuleExport = { readonly [opaque]: "ModuleExport" }

type InternalValue = { readonly [opaque]: "InternalValue" }

type InternalMethod = () => Promise<InternalValue | undefined> | InternalValue | undefined

type InternalApi = { readonly [method: string]: InternalMethod | undefined }

type Registry = { readonly resolve: (token: ModuleExport) => InternalApi }

type Platform = { readonly getRegistry?: () => Registry }

type Fiber = {
  readonly child: Fiber | null
  readonly sibling: Fiber | null
  readonly memoizedProps: { readonly value?: Platform } | null
}

type Require = (id: string) => Readonly<Record<string, ModuleExport>>

type LoaderSlot = { require?: Require }

export type DispatchResult =
  | { readonly ok: true; readonly value: InternalValue | null }
  | { readonly ok: false; readonly kind: "NotReady" | "ApiMissing" | "MethodMissing" | "Rejected"; readonly message: string }

type Agent = {
  readonly version: number
  readonly dispatch: (api: string, method: string) => Promise<DispatchResult>
}

declare global {
  interface Window {
    __spotr?: Agent
    rspackChunk?: Array<[ReadonlyArray<symbol>, Readonly<Record<string, never>>, (require: Require) => void]>
    __webpack_modules__?: Readonly<Record<string, { toString(): string }>>
  }
}

export const installAgent = (): Agent => {
  const version = 1

  if (window.__spotr?.version === version) return window.__spotr

  // Spotify's bundler (rspack) exposes its module loader to any chunk
  // pushed onto this array.
  const captured: LoaderSlot = {}

  window.rspackChunk?.push([[Symbol("spotr")], {}, (require) => { captured.require = require }])

  // Each internal API is registered under a token created in a tiny
  // module like `let r=(0,i(62359).u)("PlayerAPI")`.
  const tokens = new Map<string, string>()

  for (const [id, mod] of Object.entries(window.__webpack_modules__ ?? {})) {
    const source = mod.toString()

    if (source.length > 400) continue
    const match = source.match(/\.u\)\("([A-Za-z]+)"\)/)

    if (match?.[1]) tokens.set(match[1], id)
  }

  // The object owning getRegistry() is passed down React's tree as a
  // context value, so walk the tree from the root element.
  const findPlatform = () => {
    const root = document.querySelector("#main") ?? document.body.firstElementChild

    if (!root) return undefined
    const entry = Object.entries(root).find(([key]) => key.startsWith("__reactContainer"))
    const start: Fiber | undefined = entry?.[1]
    const stack: Array<Fiber> = start ? [start] : []
    const seen = new Set<Fiber>()

    while (stack.length > 0) {
      const fiber = stack.pop()

      if (!fiber || seen.has(fiber)) continue
      seen.add(fiber)
      const value = fiber.memoizedProps?.value

      if (value?.getRegistry) return value

      if (value) {
        // The platform may sit one level down, e.g. { platform, ... }.
        const bag: object = value
        const nested: Array<Platform | undefined> = Object.values(bag)
        const found = nested.find((candidate) => candidate?.getRegistry)

        if (found) return found
      }

      if (fiber.child) stack.push(fiber.child)

      if (fiber.sibling) stack.push(fiber.sibling)
    }

    return undefined
  }

  const registry = findPlatform()?.getRegistry?.()

  const resolveApi = (name: string) => {
    const id = tokens.get(name)

    if (!id || !captured.require || !registry) return undefined

    for (const token of Object.values(captured.require(id))) {
      try {
        return registry.resolve(token)
      } catch {
        // This export wasn't the token; try the module's next export.
      }
    }

    return undefined
  }

  const agent: Agent = {
    version,
    async dispatch(api, method) {
      if (!registry) return { ok: false, kind: "NotReady", message: "Spotify's internal registry wasn't found" }
      const target = resolveApi(api)

      if (!target) return { ok: false, kind: "ApiMissing", message: `No internal API named ${api}` }
      const fn = target[method]

      if (!fn) return { ok: false, kind: "MethodMissing", message: `${api} has no method ${method}` }

      try {
        const value = await fn.call(target)

        // A JSON round trip turns Spotify's class instances into plain
        // data that survives the trip back over the DevTools socket.
        return { ok: true, value: value === undefined ? null : JSON.parse(JSON.stringify(value)) }
      } catch (error) {
        return { ok: false, kind: "Rejected", message: String(error) }
      }
    }
  }

  window.__spotr = agent

  return agent
}
