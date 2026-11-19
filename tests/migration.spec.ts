import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { SCHEMA_VERSION, Store } from '../src/app/store.ts'
import { OLDEST_SCHEMA, tooOld } from '../src/app/migration.ts'
import { KV } from '../src/kv.ts'

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'orchestrator-migration-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

it('opens a new database at schema 12, and opens it again unchanged', () => {
  const path = join(directory, 'db.sqlite')
  expect([SCHEMA_VERSION, OLDEST_SCHEMA]).toEqual([12, 12])
  const store = new Store(path)
  expect(store.get(KV.store.schema)).toBe(12)
  store.set('marker', 'kept')
  store.close()
  const again = new Store(path)
  expect([again.get(KV.store.schema), again.get('marker')]).toEqual([12, 'kept'])
  again.close()
})

it('refuses a database of an earlier schema, which held the earlier Sources\' records, and leaves it as it was', () => {
  const path = join(directory, 'db.sqlite')
  new Store(path).close()
  const schema = (version: number) => {
    const db = new DatabaseSync(path)
    db.prepare("UPDATE kv SET value=? WHERE key='schema'").run(String(version))
    db.prepare('INSERT OR REPLACE INTO kv VALUES (?,?)').run('source-cursor', JSON.stringify('2026-09-09T00:00:00Z'))
    db.close()
  }
  for (const version of [11, 10, 9]) {
    schema(version)
    const before = readFileSync(path)
    expect(() => new Store(path)).toThrow(tooOld(version))
    expect(tooOld(version)).toMatch(new RegExp(`schema ${version} predates schema 12, which this version cannot migrate; start with a new state directory`))
    expect(readFileSync(path).equals(before)).toBe(true)
    const db = new DatabaseSync(path)
    expect(db.prepare("SELECT value FROM kv WHERE key='schema'").get()).toEqual({ value: String(version) })
    db.close()
  }
  // A later schema than this build knows is refused too; a refusal releases the database so a later attempt can open it.
  schema(13)
  expect(() => new Store(path)).toThrow('Unsupported orchestrator database version 13')
  schema(12)
  new Store(path).close()
})
