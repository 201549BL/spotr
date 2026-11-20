// Runs INSIDE Spotify's page. CdpBridge sends `installAgent.toString()`,
// so the function body must be self-contained: no imports and no
// references to anything outside it. Types are fine; they are erased.

declare const opaque: unique symbol

// Values owned by Spotify that the agent passes along without inspecting.
type InternalValue = { readonly [opaque]: "InternalValue" }

type Json = null | number | boolean | string | ReadonlyArray<Json> | { readonly [key: string]: Json }

type InternalMethod = (...args: ReadonlyArray<Json>) => Promise<InternalValue | undefined> | InternalValue | undefined

type InternalApi = { readonly [method: string]: InternalMethod | undefined }

// Spotify registers each API under a Symbol whose description is the
// API's name, e.g. Symbol("PlayerAPI").
type Token = { readonly description?: string | undefined }

type Registry = {
  readonly _map: ReadonlyMap<Token, InternalValue>
  readonly resolve: (token: Token) => InternalApi
}

type Platform = { readonly getRegistry?: () => Registry }

type Fiber = {
  readonly child: Fiber | null
  readonly sibling: Fiber | null
  readonly memoizedProps: { readonly value?: Platform } | null
}

type Failure = {
  readonly ok: false
  readonly kind: "NotReady" | "ApiMissing" | "MethodMissing" | "Rejected"
  readonly message: string
}

export type DispatchResult = { readonly ok: true; readonly value: InternalValue | null } | Failure

// The methods of `methods` that the API lacks. Nothing is called.
export type InspectResult = { readonly ok: true; readonly value: ReadonlyArray<string> } | Failure

type Agent = {
  readonly version: number
  readonly dispatch: (api: string, method: string, args: ReadonlyArray<Json>) => Promise<DispatchResult>
  readonly inspect: (api: string, methods: ReadonlyArray<string>) => InspectResult
}

declare global {
  interface Window {
    __spotr?: Agent
  }
}

export const installAgent = (): Agent => {
  const version = 4

  if (window.__spotr?.version === version) return window.__spotr

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
    if (!registry) return undefined
    const token = [...registry._map.keys()].find((key) => key?.description === name)

    return token ? registry.resolve(token) : undefined
  }

  const agent: Agent = {
    version,
    inspect(api, methods) {
      if (!registry) return { ok: false, kind: "NotReady", message: "Spotify's internal registry wasn't found" }
      const target = resolveApi(api)

      if (!target) return { ok: false, kind: "ApiMissing", message: `No internal API named ${api}` }

      return { ok: true, value: methods.filter((method) => !target[method]) }
    },
    async dispatch(api, method, args) {
      if (!registry) return { ok: false, kind: "NotReady", message: "Spotify's internal registry wasn't found" }
      const target = resolveApi(api)

      if (!target) return { ok: false, kind: "ApiMissing", message: `No internal API named ${api}` }
      const fn = target[method]

      if (!fn) return { ok: false, kind: "MethodMissing", message: `${api} has no method ${method}` }

      try {
        const value = await fn.call(target, ...args)

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
