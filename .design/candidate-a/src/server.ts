import type { Server } from 'node:http'
import type { EventLog } from './domain.ts'

export interface ServerOptions {
  readonly port: number
  readonly home: string
  readonly cacheFile: string
  readonly pricesFile: string
}

export interface LogHolder {
  current(): Promise<EventLog>
  rescan(): Promise<EventLog>
}

export function createLogHolder(options: ServerOptions): LogHolder {
  throw new Error('not implemented')
}

export async function startServer(options: ServerOptions): Promise<Server> {
  throw new Error('not implemented')
}

function serveBrowserModule(urlPath: string): Promise<{ status: number; body: string }> {
  throw new Error('not implemented')
}
