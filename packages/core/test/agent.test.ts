import { assert, beforeEach, describe, it } from "@effect/vitest"
import { type Agent, installAgent } from "../src/locator/agent.ts"

// Runs the agent from its source text, the way CdpBridge sends it to
// Spotify. Any reference to something outside the function fails here.
const install = (): Agent => new Function(`return (${installAgent.toString()})()`)()

// Results as plain data, since the agent types Spotify's values opaquely.
const dispatch = async (agent: Agent, api: string, method: string, args: ReadonlyArray<number>) =>
  JSON.parse(JSON.stringify(await agent.dispatch(api, method, args)))

class SampleItem {
  readonly name: string

  constructor(name: string) {
    this.name = name
  }

  get shouted() {
    return this.name.toUpperCase()
  }
}

const received: Array<ReadonlyArray<number>> = []

const player = {
  getState: () => ({ item: new SampleItem("Placeholder Song") }),
  setVolume: (...args: ReadonlyArray<number>) => {
    received.push(args)
  },
  fail: () => {
    throw new Error("nope")
  },
  later: async () => 42,
  getHelper: () => ({ double: (value: number) => value * 2 })
}

type QueryDefinition = { readonly name: string; readonly operation: string; readonly sha256Hash: string; readonly value: null }

const ranQueries: Array<{ readonly definition: QueryDefinition; readonly variables: { readonly term: string } }> = []

// Spotify's GraphQL loader is itself a function, not an object of methods.
const graphQLLoader = async (definition: QueryDefinition, variables: { readonly term: string }) => {
  ranQueries.push({ definition, variables })

  return { data: { echo: variables.term } }
}

const apis = new Map<string, object>([["PlayerAPI", player], ["EmptyAPI", {}], ["GraphQLLoader", graphQLLoader]])

const registry = {
  _map: new Map([...apis.keys()].map((name) => [Symbol(name), {}])),
  resolve: (token: symbol) => apis.get(token.description ?? "") ?? {}
}

const queryHash = "a".repeat(64)

// What a React context value may hold: the platform itself, or a bag
// with the platform one level down.
type ContextValue = { readonly getRegistry: () => typeof registry } | { readonly platform: ContextValue }

// React's root fiber, with the context value on its child.
const fiberTree = (value: ContextValue | undefined) => ({
  memoizedProps: null,
  sibling: null,
  child: { memoizedProps: { value }, child: null, sibling: null }
})

const fakePage = (value: ContextValue | undefined) => {
  const root = { "__reactContainer$sample": fiberTree(value) }

  Object.assign(globalThis, {
    window: {
      __webpack_modules__: { 1: `function(e,t,i){let q=new i.l("sampleSearch","query","${queryHash}",null)}` }
    },
    document: { querySelector: (selector: string) => selector === "#main" ? root : null, body: { firstElementChild: null } }
  })
}

beforeEach(() => {
  received.length = 0
  ranQueries.length = 0
  fakePage({ platform: { getRegistry: () => registry } })
})

describe("page agent", () => {
  it("calls a method with its arguments and returns plain JSON data", async () => {
    const agent = install()

    assert.deepStrictEqual(await dispatch(agent, "PlayerAPI", "getState", []), {
      ok: true,
      value: { item: { name: "Placeholder Song" } }
    })
    assert.deepStrictEqual(await dispatch(agent, "PlayerAPI", "setVolume", [0.5, 1]), { ok: true, value: null })
    assert.deepStrictEqual(await dispatch(agent, "PlayerAPI", "later", []), { ok: true, value: 42 })
    assert.deepStrictEqual(received, [[0.5, 1]])
  })

  it("follows a getter for a method path like getHelper.double", async () => {
    const agent = install()

    assert.deepStrictEqual(await dispatch(agent, "PlayerAPI", "getHelper.double", [21]), { ok: true, value: 42 })
    assert.deepStrictEqual(await dispatch(agent, "PlayerAPI", "getHelper.triple", [1]), {
      ok: false,
      kind: "MethodMissing",
      message: "PlayerAPI has no method getHelper.triple"
    })
    assert.deepStrictEqual(agent.inspect("PlayerAPI", ["getHelper.double", "getNothing.double"]), {
      ok: true,
      value: ["getNothing.double"]
    })
  })

  it("runs a GraphQL query with the hash Spotify's code defines for it", async () => {
    const agent = install()
    const result = JSON.parse(JSON.stringify(await agent.graphql("sampleSearch", { term: "jazz" })))

    assert.deepStrictEqual(result, { ok: true, value: { data: { echo: "jazz" } } })
    assert.deepStrictEqual(ranQueries, [
      { definition: { name: "sampleSearch", operation: "query", sha256Hash: queryHash, value: null }, variables: { term: "jazz" } }
    ])
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await agent.graphql("noSuchQuery", {}))), {
      ok: false,
      kind: "QueryMissing",
      message: "Spotify's code defines no query named noSuchQuery"
    })
    assert.deepStrictEqual(agent.inspectQueries(["sampleSearch", "noSuchQuery"]), { ok: true, value: ["noSuchQuery"] })
  })

  it("returns plain objects rather than Spotify's class instances", async () => {
    const result = await install().dispatch("PlayerAPI", "getState", [])
    const [item] = result.ok && result.value ? Object.values(result.value) : []

    assert.strictEqual(Object.getPrototypeOf(item), Object.prototype)
  })

  it("reports failures as data instead of throwing", async () => {
    const agent = install()

    assert.deepStrictEqual(await dispatch(agent, "PlayerAPI", "fail", []), { ok: false, kind: "Rejected", message: "Error: nope" })
    assert.deepStrictEqual(await dispatch(agent, "PlayerAPI", "nope", []), {
      ok: false,
      kind: "MethodMissing",
      message: "PlayerAPI has no method nope"
    })
    assert.deepStrictEqual(await dispatch(agent, "MadeUpAPI", "getState", []), {
      ok: false,
      kind: "ApiMissing",
      message: "No internal API named MadeUpAPI"
    })
  })

  it("is not ready when the page has no registry", async () => {
    fakePage(undefined)

    assert.deepStrictEqual(await dispatch(install(), "PlayerAPI", "getState", []), {
      ok: false,
      kind: "NotReady",
      message: "Spotify's internal registry wasn't found"
    })
  })

  it("finds a platform passed directly as the context value", async () => {
    fakePage({ getRegistry: () => registry })

    assert.deepStrictEqual(await dispatch(install(), "PlayerAPI", "later", []), { ok: true, value: 42 })
  })

  it("inspect lists missing methods without calling any", () => {
    const agent = install()

    assert.deepStrictEqual(agent.inspect("PlayerAPI", ["setVolume", "getQueue", "fail"]), { ok: true, value: ["getQueue"] })
    assert.deepStrictEqual(agent.inspect("EmptyAPI", ["anything"]), { ok: true, value: ["anything"] })
    assert.deepStrictEqual(received, [])
  })

  it("installs once per version and replaces an older agent", () => {
    const first = install()

    assert.strictEqual(install(), first)

    const older = { ...first, version: 1 }

    Object.assign(globalThis, { window: { __spotrc: older } })

    const replaced = install()

    assert.notStrictEqual(replaced, older)
    assert.strictEqual(replaced.version, first.version)
  })
})
