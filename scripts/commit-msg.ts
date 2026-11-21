// Rejects a commit message whose first line isn't a conventional commit,
// such as "feat(search): add search". lefthook passes the message file.
import { readFileSync } from "node:fs"

const types = ["feat", "fix", "docs", "refactor", "test", "perf", "build", "ci", "chore", "style", "revert"]
const pattern = new RegExp(`^(${types.join("|")})(\\([a-z0-9-]+\\))?!?: \\S`)

const [file] = process.argv.slice(2)
const subject = readFileSync(file ?? "", "utf8").split("\n")[0] ?? ""

if (!pattern.test(subject) && !subject.startsWith("Merge ")) {
  console.error(`Not a conventional commit: "${subject}"`)
  console.error(`Start it with one of ${types.join(", ")}, an optional (scope), then ": ", e.g. "feat(queue): add queue clear".`)
  process.exit(1)
}
