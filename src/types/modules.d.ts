declare module 'oui' {
  function oui(mac: string): string | null
  export = oui
}

declare module 'net-snmp' {
  export const Version1: number
  export const Version2c: number
  export const Version3: number

  export interface SessionOptions {
    port?: number
    timeout?: number
    retries?: number
    version?: number
  }

  export interface Varbind {
    oid: string
    type: number
    value: Buffer | string | number
  }

  export interface Session {
    get(oids: string[], callback: (error: Error | null, varbinds: Varbind[]) => void): void
    close(): void
  }

  export function createSession(target: string, community: string, options?: SessionOptions): Session
  export function isVarbindError(varbind: Varbind): boolean
}
