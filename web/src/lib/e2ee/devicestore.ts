/**
 * What this browser keeps so the account key can be reopened after signing in again — never the
 * key itself:
 *
 * - `muni-unlock` (IndexedDB): per account, the device envelope (wrap.ts) and this device's half of
 *   its wrapping key. Useless without the other half, which only the account's own sessions get.
 * - `muni-keys` (IndexedDB): teammates' pinned public keys, so a key that changes unexpectedly is
 *   noticed before a sprint's key is shared with it.
 *
 * Browser storage is not a vault: anyone who can run code in this browser profile while the key is
 * unlocked can use it. What storage adds here is only what an envelope can't be opened without.
 */
export type DeviceRecord = { accountId: string; deviceId: string; ds: string; envelope: string; keyVersion: number; pk: string; savedAt: number }

export interface DeviceStore {
  getDevice(accountId: string): Promise<DeviceRecord | null>
  /** Throws when the browser won't store it (private mode, quota, storage blocked). */
  putDevice(r: DeviceRecord): Promise<void>
  deleteDevice(accountId: string): Promise<void>
  getPin(key: string): Promise<string | null>
  putPin(key: string, pk: string): Promise<void>
  deletePins(accountId: string): Promise<void>
}

/** In memory: tests, and browsers without IndexedDB (nothing survives a reload there). */
export function memoryDeviceStore(): DeviceStore & { dump(): string } {
  const devices = new Map<string, DeviceRecord>()
  const pins = new Map<string, string>()
  return {
    dump: () => JSON.stringify({ devices: [...devices.values()], pins: [...pins.entries()] }),
    async getDevice(id) {
      return devices.get(id) ?? null
    },
    async putDevice(r) {
      devices.set(r.accountId, { ...r })
    },
    async deleteDevice(id) {
      devices.delete(id)
    },
    async getPin(k) {
      return pins.get(k) ?? null
    },
    async putPin(k, pk) {
      pins.set(k, pk)
    },
    async deletePins(id) {
      for (const k of [...pins.keys()]) if (k.startsWith(`${id}|`)) pins.delete(k)
    },
  }
}

function openDb(name: string, version: number, upgrade: (db: IDBDatabase) => void): () => Promise<IDBDatabase> {
  let conn: Promise<IDBDatabase> | null = null
  return () => {
    if (conn) return conn
    conn = new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(name, version)
      r.onupgradeneeded = () => upgrade(r.result)
      r.onsuccess = () => {
        const db = r.result
        // Another tab needs a newer version: step aside instead of blocking it.
        db.onversionchange = () => {
          db.close()
          conn = null
        }
        db.onclose = () => {
          conn = null
        }
        resolve(db)
      }
      r.onerror = () => {
        conn = null
        reject(r.error ?? new Error('storage unavailable'))
      }
      r.onblocked = () => {
        conn = null
        reject(new Error('storage busy in another tab'))
      }
    })
    return conn
  }
}

async function tx<T>(open: () => Promise<IDBDatabase>, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    t.oncomplete = () => resolve(req ? req.result : undefined)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error ?? new Error('storage aborted'))
  })
}

export function indexedDbDeviceStore(): DeviceStore {
  const unlock = openDb('muni-unlock', 1, (db) => db.createObjectStore('devices', { keyPath: 'accountId' }))
  const pinsDb = openDb('muni-keys', 1, (db) => {
    if (!db.objectStoreNames.contains('pins')) db.createObjectStore('pins')
  })
  return {
    async getDevice(id) {
      return ((await tx<DeviceRecord>(unlock, 'devices', 'readonly', (s) => s.get(id))) as DeviceRecord | undefined) ?? null
    },
    async putDevice(r) {
      await tx(unlock, 'devices', 'readwrite', (s) => s.put(r))
      // Read back: a store that silently drops writes is a failure, not a success.
      const back = (await tx<DeviceRecord>(unlock, 'devices', 'readonly', (s) => s.get(r.accountId))) as DeviceRecord | undefined
      if (!back || back.envelope !== r.envelope || back.ds !== r.ds) throw new Error('storage did not keep the record')
    },
    async deleteDevice(id) {
      await tx(unlock, 'devices', 'readwrite', (s) => s.delete(id))
    },
    async getPin(k) {
      return ((await tx<string>(pinsDb, 'pins', 'readonly', (s) => s.get(k)).catch(() => undefined)) as string | undefined) ?? null
    },
    async putPin(k, pk) {
      await tx(pinsDb, 'pins', 'readwrite', (s) => s.put(pk, k)).catch(() => {})
    },
    async deletePins(id) {
      const keys = ((await tx<IDBValidKey[]>(pinsDb, 'pins', 'readonly', (s) => s.getAllKeys()).catch(() => [])) as IDBValidKey[] | undefined) ?? []
      for (const k of keys) if (String(k).startsWith(`${id}|`)) await tx(pinsDb, 'pins', 'readwrite', (s) => s.delete(k)).catch(() => {})
    },
  }
}

/** IndexedDB where the browser has it; memory otherwise (tests, and browsers without it). */
export function defaultDeviceStore(): DeviceStore {
  return typeof indexedDB === 'undefined' ? memoryDeviceStore() : indexedDbDeviceStore()
}
