# Parked dead code (removed from `packages/`)

Removed because nothing in the production CLI path called these symbols. Restore when adding init flows, git scaffold, or task-runner UX.

Last audited: 2026-08-18.

---

## Core — `packages/core`

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

Kept: `isFileAsync`, `readFileAsync`, `writeFileAsync`.