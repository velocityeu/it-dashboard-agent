import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'
import { existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const { combine, timestamp, printf, colorize, uncolorize } = winston.format

// Get the project root directory
function getLogsDir(): string {
  // When running from dist/index.js, go up to project root
  const currentFile = fileURLToPath(import.meta.url)
  const projectRoot = dirname(dirname(dirname(currentFile)))
  return join(projectRoot, 'logs')
}

// Console format with colors
const consoleFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level}]: ${message}`
})

// File format without colors
const fileFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level}]: ${message}`
})

export function createLogger(level: string) {
  // Ensure logs directory exists
  const logsDir = getLogsDir()
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true })
  }

  // Daily rotating file transport
  const fileRotateTransport = new DailyRotateFile({
    dirname: logsDir,
    filename: 'agent-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '10m',
    maxFiles: '7d',
    zippedArchive: true,
    format: combine(
      uncolorize(),
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      fileFormat
    ),
  })

  // Handle rotation events
  fileRotateTransport.on('rotate', (oldFilename, newFilename) => {
    console.log(`Log rotated: ${oldFilename} -> ${newFilename}`)
  })

  return winston.createLogger({
    level,
    format: combine(
      colorize(),
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      consoleFormat
    ),
    transports: [
      new winston.transports.Console(),
      fileRotateTransport as unknown as winston.transport,
    ],
  })
}

export type Logger = ReturnType<typeof createLogger>
