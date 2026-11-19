/** Finds the plan files of a repository: the Markdown files whose repository path matches one of the plan Source's patterns. */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { key } from '../core/index.ts'

/** The largest plan file read; a larger one is skipped. */
export const PLAN_MAX_BYTES = 2 * 1024 * 1024
/** How deep below the repository files are looked for. */
const MAX_DEPTH = 10
/** How many directory entries one check looks at before it stops, so a huge checkout cannot stall the Source. */
export const MAX_ENTRIES = 100_000
/** Directories never read: hidden ones, such as `.git` and `.super-coding-agent` where replies are logged, dependencies and build output. */
const SKIPPED = new Set(['node_modules', 'vendor', 'dist', 'build', 'out', 'target', 'coverage', '__pycache__', 'venv'])
const skipped = (name: string): boolean => name.startsWith('.') || SKIPPED.has(name)

/** The patterns of common planning tools: superpowers, BMAD stories, speckit task lists, and plan or task files and folders. */
export const DEFAULT_PATTERNS: readonly string[] = ['PLAN.md', 'PLANS.md', 'TASKS.md', 'TODO.md', 'plans/**/*.md', 'tasks/**/*.md',
  'docs/plans/**/*.md', 'docs/superpowers/plans/**/*.md', 'docs/stories/**/*.md', '_bmad-output/**/stories/**/*.md', 'specs/**/tasks.md']

/** A glob over `/`-separated repository paths, case-insensitive: `**` spans any number of directories, `*` and `?` stay within one. */
export function globMatcher(pattern: string): RegExp {
  const source = pattern.trim().replace(/^\.?\//, '').split('/').map((part, at, parts) => part === '**'
    ? at === parts.length - 1 ? '.*' : '(?:[^/]+/)*'
    : part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + (at === parts.length - 1 ? '' : '/'))
    .join('')
  return new RegExp(`^${source}$`, 'i')
}

/** One plan file: its repository path with `/` separators, its absolute path, text, hash and change time. */
export interface PlanFile { path: string; file: string; text: string; hash: string; at: string }
/**
 * What one look at the repository found: the plan files sorted by path, those too large to read, and the paths it could not
 * read, a directory named with a trailing `/`, whose plans are neither received nor forgotten.
 */
export interface PlanScan { files: PlanFile[]; large: string[]; unreadable: string[]; truncated: boolean }

/** Every Markdown file below `root` whose repository path matches one of `patterns`. */
export async function planFiles(root: string, patterns: readonly string[]): Promise<PlanScan> {
  const matchers = patterns.map(globMatcher)
  const files: PlanFile[] = [], large: string[] = [], unreadable: string[] = []
  let entries = 0
  const path = (file: string) => relative(root, file).split(sep).join('/')
  const walk = async (directory: string, depth: number): Promise<void> => {
    const listed = depth === 0 ? await readdir(directory, { withFileTypes: true })
      : await readdir(directory, { withFileTypes: true }).catch(() => { unreadable.push(`${path(directory)}/`); return [] })
    for (const entry of listed) {
      if (++entries > MAX_ENTRIES) return
      const file = join(directory, entry.name)
      if (entry.isDirectory()) { if (!skipped(entry.name) && depth < MAX_DEPTH) await walk(file, depth + 1); continue }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
      const relativePath = path(file)
      if (!matchers.some(matcher => matcher.test(relativePath))) continue
      try {
        const info = await stat(file)
        if (info.size > PLAN_MAX_BYTES) { large.push(relativePath); continue }
        const text = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n')
        files.push({ path: relativePath, file, text, hash: key('plan-file', text), at: info.mtime.toISOString() })
      } catch { unreadable.push(relativePath) }
    }
  }
  await walk(root, 0)
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), large: large.sort(), unreadable: unreadable.sort(), truncated: entries > MAX_ENTRIES }
}
