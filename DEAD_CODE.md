# Parked dead code (removed from `packages/`)

Removed because nothing in the production CLI path (`list` + registry load/build) called these symbols — they were only exercised by unit tests. Restore when adding install/init flows (prompts, task runners, git scaffold, condition inference, variant resolution).

Last audited: 2026-07-27.

---

## CLI — `packages/cli`

### `src/cli/prompts.ts` (delete + `prompts.test.ts`)

Consola wrappers with cancel → `logger.end("Operation canceled")`.

| Export | Behaviour |
|--------|-----------|
| `textInput(message, opts?, default?)` | `consola.prompt` type `text`; if `opts.required` and empty → `logger.error("Package name is required")`; return trimmed string |
| `selectInput(message, opts?, default?)` | type `select`; default `opts = { options: [] }` |
| `multiselectInput(message, opts?, defaults?)` | type `multiselect` |
| `confirmInput(message, opts?, default?)` | type `confirm`; return `Boolean(res)` |
| default | `{ textInput, selectInput, multiselectInput, confirmInput }` |

Cancel detection: `value === Symbol.for("cancel")`.

Dep: `consola` (keep — still used by `animated-intro` via `consola/utils`).

### `src/cli/tasks.ts` (delete + `tasks.test.ts`)

listr2 goal + optional subtasks; titles via `primaryText` / `defaultText`.

| Export | Behaviour |
|--------|-----------|
| `task(title, fn)` | `{ title, task: fn }` |
| `conditionalTask(cond, subtask)` | `[subtask]` or `[]` |
| `runWithTasks(goalTitle, task?, subtasks?, { collapseErrors? })` | One Listr parent; if `task` set run it alone, else nest `subtasks`; default `collapseErrors: true` |
| default | `{ runWithTasks, task, conditionalTask }` |

Dep: re-add `"listr2": "^10.1.0"` to `packages/cli/package.json`.

### `Logger.end` (`src/cli/logger.ts`)

```ts
end(message: string) {
  console.log();
  console.error(`${dangerHighlight(" end ")} ${message}`);
  console.log();
  process.exit(0);
}
```

Used by prompts cancel handling.

### `getBooleanOption` (`src/cli/options.ts`)

```ts
export function getBooleanOption(options: CliOptions, key: string): boolean {
  return options[key] === true;
}
```

---

## Core — `packages/core`

Barrel (`src/index.ts`) previously re-exported: `./git`, `./shell`, `./utils`, `./infer`.

### `src/shell.ts` (+ `shell.test.ts`)

`RunOptions`: `{ cwd?, stdio?: "inherit"|"pipe"|"ignore", env?, timeoutMs? }`.

- **`parseCommand(cmd)`** (private): quote-aware split → `{ command, args }`.
- **`runAsync(cmd, opts?)`**: `spawn` without shell; `pipe` (default) returns trimmed stdout; `inherit`/`ignore` resolve `""` on exit 0; reject on non-zero.
- **`commandExistsAsync(command)`**: `where` on win32, else `which`; catch → `false`.

### `src/git.ts` (+ `git.test.ts`)

Depends on `runAsync`.

- **`isGitRepo(cwd)`** (private): `existsSync(cwd/.git)`.
- **`readGitConfig(key)`**: `git config --get ${key}` → trimmed string or `undefined`.
- **`initGitRepo(cwd)`**: no-op if repo; else `git init -b main` (`stdio: "ignore"`).
- **`makeInitialCommit(cwd)`**: ensure repo → `git add -A` → `git commit -m "chore: initial commit"`.

### `src/utils.ts` (+ `utils.test.ts`)

**`toSlug(value)`**: trim/lower; last path segment; strip leading `@` and trailing `.git`; replace non `[a-z0-9._-]` with `-`; collapse/trim hyphens.

### `src/fs.ts` (partial — keep live helpers)

Removed (safe no-ops when missing):

- **`copyFileSafeAsync(src, dest)`**: if regular file → `ensureDir` dest parent → `copyFile`.
- **`copyDirSafeAsync(srcDir, destDir)`**: recursive dir copy via `copyFileSafeAsync`.
- **`removeMatchingFilesRecursively(root, predicate(basename, full, dirent))`**: delete matching files/dirs; recurse non-matching dirs.
- **`stripKeyFromJSONFile(filePath, key)`**: delete root JSON key and rewrite; ignore missing/invalid.

Kept: `isRegularFileAsync`, `readJSONFileAsync`, `ensureDirAsync`, `writeFileAsync`.

### `src/infer.ts` (+ `infer.test.ts`)

```ts
export type InferConditionOptions = {
  pathExists?: (absolutePath: string) => boolean;
};

export async function inferConditionValues(
  conditions: Record<string, RegistryCondition> | undefined,
  projectDir: string,
  options?: InferConditionOptions,
): Promise<RegistryContext>
```

Only conditions with `inference` set. Mode `RegistryConditionInference.FILES`: pick value whose `files[]` has any existing path under `projectDir`; require **exactly one** match else skip. Unknown inference → throw.

### `src/schema.ts` (partial — install / variant planning)

Kept document types + `getRegistryItemTypes`. Removed:

**Types:** `RegistryContext`, `RegistryDependencyRef`, `ResolvedRegistryItem`, `ResolvedRegistryPlan`, `RegistryIndex`, `RequiredCondition`.

**`variantMatchesContext(variant, context)`** — no `when` → true; else every `when[k] === context[k]`.

**`selectRegistryVariant(item, context, pinnedVariantId?)`** — pinned by id (ignore when); else matching variants sorted by most `when` keys; else first unconditional; else throw.

**`collectConditionKeys(items)`** / **`collectConditionValues(items, key)`** — unique sorted keys/values from variant `when`.

**`parseRegistryDependencyRef(ref)`** — `id` or `id@variant`; reject empty / leading/trailing `@`.

**`resolveRegistryPlan(rootRef, index, context)`** — DFS deps (`item` + selected variant `registryDependencies`), cycle-detect, dedupe by id; merge npm `dependencies` / `devDependencies` sorted; files = item.files + variant.files.

**`collectRequiredConditions(items, conditions, context)`** — for each used `when` key missing in context: intersect declared condition values with values present on plan variants; skip empty intersections; throw if key undefined in `conditions`.

Private helpers: `normalizeDependency`, `collectItemDependencies`.

---

## Recreate checklist

1. Restore modules under paths above; re-export from `packages/core/src/index.ts` as needed.
2. Re-add `listr2` if restoring tasks.
3. Wire into future `add`/`init` commands (prompts → conditions; infer → context; `resolveRegistryPlan` → install; tasks/git → scaffold).
4. Restore co-located `*.test.ts` from git history if behaviour regressions matter (`git log --all -- path`).
