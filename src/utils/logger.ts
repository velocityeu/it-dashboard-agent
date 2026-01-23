import winston from 'winston'

const { combine, timestamp, printf, colorize } = winston.format

const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level}]: ${message}`
})

export function createLogger(level: string) {
  return winston.createLogger({
    level,
    format: combine(
      colorize(),
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      logFormat
    ),
    transports: [
      new winston.transports.Console(),
    ],
  })
}

export type Logger = ReturnType<typeof createLogger>
