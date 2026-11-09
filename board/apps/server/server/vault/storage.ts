import { randomUUID } from "node:crypto"
import { lstat, mkdir, open, readFile, readdir, readlink, realpath, rename, link, symlink, unlink } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"
import { fold, hash, LOCK } from "./model"

const queues = new Map<string, Promise<unknown>>()
export async function serial<T>(root: string, fn: (store: Storage) => Promise<T>): Promise<T> {
  const path = resolve(root)
  const previous = queues.get(path) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(async () => {
    await mkdir(path, { recursive: true })
    if ((await lstat(path)).isSymbolicLink()) throw new Error("vault root is a symlink")
    const store = new Storage(await realpath(path))
    const token = randomUUID()
    const lock = await open(join(store.root, LOCK), "wx", 0o600)
    let lockStat: Awaited<ReturnType<typeof lock.stat>> | undefined
    const setupErrors: unknown[] = []
    try { lockStat = await lock.stat(); await lock.writeFile(token) } catch (e) { setupErrors.push(e) }
    try { await lock.close() } catch (e) { setupErrors.push(e) }
    if (setupErrors.length) {
      try {
        if (!lockStat) throw new Error("cannot verify lock ownership; manual recovery required")
        const current = await lstat(join(store.root, LOCK))
        if (current.isSymbolicLink() || current.dev !== lockStat.dev || current.ino !== lockStat.ino) throw new Error("vault lock ownership lost")
        await unlink(join(store.root, LOCK))
      } catch (e) { throw new AggregateError([...setupErrors, e], "vault lock setup and cleanup failed; manual recovery required") }
      if (setupErrors.length > 1) throw new AggregateError(setupErrors, "vault lock setup failed")
      throw setupErrors[0]
    }
    const release = async () => {
      if (await store.read(LOCK) !== token) throw new Error("vault lock ownership lost")
      await unlink(join(store.root, LOCK))
    }
    let result: T
    try { result = await fn(store) } catch (e) {
      try { await release() } catch (cleanup) { throw new AggregateError([e, cleanup], "vault operation and lock release failed") }
      throw e
    }
    await release()
    return result
  })
  queues.set(path, next)
  try { return await next } finally { if (queues.get(path) === next) queues.delete(path) }
}
export class Storage {
  constructor(readonly root: string) {}
  async target(path: string, makeDir = false, creating = false): Promise<string> {
    if (!path || path.includes("\\") || path.startsWith("/") || path.split("/").some(p => !p || p === "." || p === "..")) throw new Error(`unsafe path: ${path}`)
    const full = resolve(this.root, path)
    if (!full.startsWith(this.root + sep)) throw new Error(`unsafe path: ${path}`)
    const components = path.split("/")
    let current = this.root
    for (const [i, part] of components.entries()) {
      const parent = current
      current = join(parent, part)
      let missing = false
      try {
        const st = await lstat(current)
        if (st.isSymbolicLink()) throw new Error(`symlink rejected: ${path}`)
        if (i < components.length - 1 && !st.isDirectory()) throw new Error(`not a directory: ${path}`)
        if (i === components.length - 1 && !st.isFile()) throw new Error(`not a file: ${path}`)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e
        missing = true
      }
      if (creating && (missing || i === components.length - 1)) {
        const entries = await readdir(parent)
        if (entries.some(name => fold(name) === fold(part) && name !== part)) throw new Error(`case or Unicode collision: ${path}`)
      }
      if (missing) {
        if (i < components.length - 1) {
          if (!makeDir) return full
          await mkdir(current)
        }
      }
    }
    return full
  }
  async read(path: string): Promise<string | null> {
    const full = await this.target(path)
    try { return await readFile(full, "utf8") } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e }
  }
  private async moveAside(path: string, expectedHash: string): Promise<string | null> {
    const full = await this.target(path)
    const old = join(dirname(full), `.vault-old-${randomUUID()}`)
    try { await rename(full, old) } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null
      throw e
    }
    try {
      const stat = await lstat(old)
      if (!stat.isFile() || stat.isSymbolicLink() || hash(await readFile(old, "utf8")) !== expectedHash) throw new Error(`vault file changed: ${path}`)
    } catch (error) {
      // Hard-link restores without replacing anything newly created at the original path.
      try {
        if ((await lstat(old)).isSymbolicLink()) await symlink(await readlink(old), full)
        else await link(old, full)
        await unlink(old)
      }
      catch (restoreError) { throw new AggregateError([error, restoreError], `vault file preserved at ${old}`) }
      throw error
    }
    return old
  }
  async write(path: string, content: string, exclusive = false, expectedHash?: string): Promise<void> {
    const full = await this.target(path, true, exclusive)
    const tmp = join(dirname(full), `.vault-tmp-${randomUUID()}`)
    const file = await open(tmp, "wx", 0o600)
    try {
      try { await file.writeFile(content) } finally { await file.close() }
      if (hash(await readFile(tmp, "utf8")) !== hash(content)) throw new Error("temporary file verification failed")
      await this.target(path, false, exclusive)
      if (expectedHash !== undefined) {
        const old = await this.moveAside(path, expectedHash)
        // If the destination reappears, leave the displaced file for the operator.
        await link(tmp, full)
        await unlink(tmp)
        // An in-place write to the displaced inode between verification and unlink is not preventable here.
        if (old !== null) await unlink(old)
      } else if (exclusive) { await link(tmp, full); await unlink(tmp) } else await rename(tmp, full)
    } catch (e) { await unlink(tmp).catch(() => {}); throw e }
  }
  async remove(path: string, expectedHash?: string): Promise<void> {
    if (expectedHash === undefined) { await unlink(await this.target(path)); return }
    const old = await this.moveAside(path, expectedHash)
    // A writer retaining the displaced inode can still edit it after verification.
    if (old !== null) await unlink(old)
  }
}
