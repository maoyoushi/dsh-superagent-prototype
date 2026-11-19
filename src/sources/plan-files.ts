/** Reads the plan files of a plan directory: every Markdown file below it, outside hidden directories, with its content hash. */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { key } from '../core/index.ts'

/** The largest plan file read; a larger one is skipped. */
export const PLAN_MAX_BYTES = 2 * 1024 * 1024
/** How deep below the plan directory files are read. */
const MAX_DEPTH = 8
/** Directories never read: hidden ones, such as `.superagent` where replies are logged, and dependencies. */
const skipped = (name: string): boolean => name.startsWith('.') || name === 'node_modules'

/** One plan file: its path relative to the plan directory with `/` separators, its absolute path, text, hash and change time. */
export interface PlanFile { path: string; file: string; text: string; hash: string; at: string }

/** Every plan file below `root`, sorted by path; files larger than `PLAN_MAX_BYTES` are counted in `skipped` instead. */
export async function planFiles(root: string): Promise<{ files: PlanFile[]; skipped: string[] }> {
  const files: PlanFile[] = [], large: string[] = []
  const walk = async (directory: string, depth: number): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) { if (!skipped(entry.name) && depth < MAX_DEPTH) await walk(file, depth + 1); continue }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
      const info = await stat(file)
      const path = relative(root, file).split(sep).join('/')
      if (info.size > PLAN_MAX_BYTES) { large.push(path); continue }
      const text = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n')
      files.push({ path, file, text, hash: key('plan-file', text), at: info.mtime.toISOString() })
    }
  }
  await walk(root, 0)
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), skipped: large.sort() }
}
