// Runs INSIDE Spotify's page. CdpBridge sends `installAgent.toString()`,
// so the function body must be self-contained: no imports and no
// references to anything outside it. Types are fine; they are erased.

declare const opaque: unique symbol

// Values owned by Spotify that the agent passes along without inspecting.
type InternalValue = { readonly [opaque]: "InternalValue" }

type Json = null | number | boolean | string | ReadonlyArray<Json> | { readonly [key: string]: Json }

type InternalApi = { readonly [method: string]: InternalMethod | undefined }

// A method may also return another API-like object, as getMuteHelper() does.
type InternalResult = InternalValue | InternalApi | undefined

type InternalMethod = (...args: ReadonlyArray<Json>) => Promise<InternalResult> | InternalResult

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

export type Agent = {
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
  const version = 5

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

      // For a path like "getMuteHelper.mute" only the first step is
      // checked, since checking the rest would mean calling the getter.
      return { ok: true, value: methods.filter((method) => !target[method.split(".")[0] ?? method]) }
    },
    async dispatch(api, method, args) {
      if (!registry) return { ok: false, kind: "NotReady", message: "Spotify's internal registry wasn't found" }
      const target = resolveApi(api)

      if (!target) return { ok: false, kind: "ApiMissing", message: `No internal API named ${api}` }

      try {
        // "getMuteHelper.mute" calls getMuteHelper() first, then mute()
        // on what it returns.
        const steps = method.split(".")
        const last = steps.pop() ?? method
        let owner: InternalApi | undefined = target

        for (const step of steps) {
          const getter: InternalMethod | undefined = owner?.[step]

          // SAFETY: every step before the last names a getter, such as
          // getMuteHelper, that returns another API object.
          owner = getter ? await getter.call(owner) as InternalApi | undefined : undefined
        }

        const fn = owner?.[last]

        if (!owner || !fn) return { ok: false, kind: "MethodMissing", message: `${api} has no method ${method}` }

        const value = await fn.call(owner, ...args)

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
