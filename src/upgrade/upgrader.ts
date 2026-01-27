/**
 * Agent Upgrader - Handles self-upgrade process with backup/rollback
 */

import { spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, copyFileSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { pipeline } from 'stream/promises'
import { createGunzip } from 'zlib'
import https from 'https'
import http from 'http'
import type { Logger } from '../utils/logger.js'

export interface UpgradeResult {
  success: boolean
  previousVersion: string
  newVersion?: string
  error?: string
}

export class AgentUpgrader {
  private installPath: string
  private downloadUrl: string
  private logger: Logger
  private backupPath: string | null = null

  constructor(installPath: string, downloadUrl: string, logger: Logger) {
    this.installPath = installPath
    this.downloadUrl = downloadUrl
    this.logger = logger
  }

  /**
   * Perform the upgrade process
   */
  async upgrade(): Promise<UpgradeResult> {
    const previousVersion = await this.getCurrentVersion()
    this.logger.info(`Starting upgrade from v${previousVersion}`)

    try {
      // Step 1: Create backup
      this.logger.info('Creating backup of current installation...')
      this.backupPath = await this.backup()
      this.logger.info(`Backup created at: ${this.backupPath}`)

      // Step 2: Download new version
      this.logger.info('Downloading new version...')
      const zipPath = await this.download()
      this.logger.info(`Downloaded to: ${zipPath}`)

      // Step 3: Extract
      this.logger.info('Extracting archive...')
      const extractPath = await this.extract(zipPath)
      this.logger.info(`Extracted to: ${extractPath}`)

      // Step 4: Build
      this.logger.info('Installing dependencies and building...')
      await this.build(extractPath)
      this.logger.info('Build completed')

      // Step 5: Verify
      this.logger.info('Verifying new build...')
      const valid = await this.verify(extractPath)
      if (!valid) {
        throw new Error('Build verification failed')
      }
      this.logger.info('Build verification passed')

      // Step 6: Swap files
      this.logger.info('Swapping files...')
      await this.swap(extractPath)
      this.logger.info('Files swapped successfully')

      // Get new version
      const newVersion = await this.getCurrentVersion()

      return {
        success: true,
        previousVersion,
        newVersion,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      this.logger.error(`Upgrade failed: ${errorMsg}`)

      // Attempt rollback
      if (this.backupPath) {
        this.logger.info('Attempting rollback...')
        try {
          await this.rollback()
          this.logger.info('Rollback completed')
        } catch (rollbackError) {
          this.logger.error(`Rollback also failed: ${rollbackError}`)
        }
      }

      return {
        success: false,
        previousVersion,
        error: errorMsg,
      }
    }
  }

  /**
   * Get current installed version from package.json
   */
  private async getCurrentVersion(): Promise<string> {
    try {
      const pkgPath = join(this.installPath, 'package.json')
      const { default: pkg } = await import(`file://${pkgPath}`, { assert: { type: 'json' } })
      return pkg.version || '0.0.0'
    } catch {
      return '0.0.0'
    }
  }

  /**
   * Create backup of current dist/ and node_modules/
   */
  private async backup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDir = join(this.installPath, '..', `it-dashboard-agent-backup-${timestamp}`)

    mkdirSync(backupDir, { recursive: true })

    // Backup dist/
    const distPath = join(this.installPath, 'dist')
    if (existsSync(distPath)) {
      this.copyRecursive(distPath, join(backupDir, 'dist'))
    }

    // Backup package.json and package-lock.json
    const pkgPath = join(this.installPath, 'package.json')
    if (existsSync(pkgPath)) {
      copyFileSync(pkgPath, join(backupDir, 'package.json'))
    }

    const lockPath = join(this.installPath, 'package-lock.json')
    if (existsSync(lockPath)) {
      copyFileSync(lockPath, join(backupDir, 'package-lock.json'))
    }

    // Note: We don't backup node_modules as it's too large and can be rebuilt

    return backupDir
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Download new version ZIP with retry logic
   */
  private async download(): Promise<string> {
    const maxRetries = 3
    const retryDelayMs = 5000
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.info(`Download attempt ${attempt}/${maxRetries}...`)
        return await this.downloadOnce()
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        this.logger.warn(`Download attempt ${attempt} failed: ${lastError.message}`)

        if (attempt < maxRetries) {
          this.logger.info(`Retrying in ${retryDelayMs / 1000} seconds...`)
          await this.sleep(retryDelayMs)
        }
      }
    }

    throw lastError || new Error('Download failed after all retries')
  }

  /**
   * Single download attempt
   */
  private async downloadOnce(): Promise<string> {
    const tempDir = join(this.installPath, '..', 'it-dashboard-agent-upgrade-temp')
    mkdirSync(tempDir, { recursive: true })

    const zipPath = join(tempDir, 'agent-upgrade.zip')
    const writeStream = createWriteStream(zipPath)

    await new Promise<void>((resolve, reject) => {
      const protocol = this.downloadUrl.startsWith('https') ? https : http

      const request = protocol.get(this.downloadUrl, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location
          if (!redirectUrl) {
            reject(new Error('Redirect without location header'))
            return
          }

          // Follow redirect
          const redirectProtocol = redirectUrl.startsWith('https') ? https : http
          redirectProtocol.get(redirectUrl, (redirectResponse) => {
            if (redirectResponse.statusCode !== 200) {
              reject(new Error(`Download failed with status: ${redirectResponse.statusCode}`))
              return
            }
            redirectResponse.pipe(writeStream)
            writeStream.on('finish', () => {
              writeStream.close()
              resolve()
            })
          }).on('error', reject)
          return
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with status: ${response.statusCode}`))
          return
        }

        response.pipe(writeStream)
        writeStream.on('finish', () => {
          writeStream.close()
          resolve()
        })
      })

      request.on('error', reject)
      request.setTimeout(60000, () => {
        request.destroy()
        reject(new Error('Download timeout'))
      })
    })

    return zipPath
  }

  /**
   * Extract ZIP to temp directory
   */
  private async extract(zipPath: string): Promise<string> {
    const extractPath = join(dirname(zipPath), 'extracted')

    // Clean up if exists
    if (existsSync(extractPath)) {
      rmSync(extractPath, { recursive: true, force: true })
    }
    mkdirSync(extractPath, { recursive: true })

    // Use PowerShell on Windows, unzip on Unix
    const isWindows = process.platform === 'win32'

    if (isWindows) {
      await this.runCommand('powershell', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path "${zipPath}" -DestinationPath "${extractPath}" -Force`,
      ])
    } else {
      await this.runCommand('unzip', ['-q', '-o', zipPath, '-d', extractPath])
    }

    // Find the extracted folder (GitHub adds repo-branch prefix)
    const contents = readdirSync(extractPath)
    const extractedFolder = contents.find((name) => {
      const fullPath = join(extractPath, name)
      return statSync(fullPath).isDirectory()
    })

    if (extractedFolder) {
      return join(extractPath, extractedFolder)
    }

    return extractPath
  }

  /**
   * Run npm install and build in extracted directory
   * Skips if pre-built release is detected (has node_modules and dist/index.js)
   */
  private async build(extractPath: string): Promise<void> {
    const distIndexPath = join(extractPath, 'dist', 'index.js')
    const nodeModulesPath = join(extractPath, 'node_modules')

    // Check if this is a pre-built release
    if (existsSync(distIndexPath) && existsSync(nodeModulesPath)) {
      this.logger.info('Pre-built release detected, skipping npm install and build')
      return
    }

    // Check if only dist exists (partial pre-built)
    if (existsSync(distIndexPath)) {
      this.logger.info('Pre-built dist detected, only running npm install')
      await this.runCommand('npm', ['install', '--production'], { cwd: extractPath })
      return
    }

    // Full build required
    this.logger.info('Running npm install...')
    await this.runCommand('npm', ['install'], { cwd: extractPath })

    this.logger.info('Running npm build...')
    await this.runCommand('npm', ['run', 'build'], { cwd: extractPath })
  }

  /**
   * Verify the build completed successfully
   */
  private async verify(extractPath: string): Promise<boolean> {
    // Check dist/index.js exists
    const indexPath = join(extractPath, 'dist', 'index.js')
    if (!existsSync(indexPath)) {
      this.logger.error('dist/index.js not found after build')
      return false
    }

    // Check package.json exists
    const pkgPath = join(extractPath, 'package.json')
    if (!existsSync(pkgPath)) {
      this.logger.error('package.json not found')
      return false
    }

    return true
  }

  /**
   * Swap the files - replace current installation with new build
   */
  private async swap(extractPath: string): Promise<void> {
    // Files/folders to replace
    const toReplace = ['dist', 'package.json', 'package-lock.json', 'src']

    for (const item of toReplace) {
      const sourcePath = join(extractPath, item)
      const targetPath = join(this.installPath, item)

      if (!existsSync(sourcePath)) {
        continue
      }

      // Remove old
      if (existsSync(targetPath)) {
        rmSync(targetPath, { recursive: true, force: true })
      }

      // Copy new
      if (statSync(sourcePath).isDirectory()) {
        this.copyRecursive(sourcePath, targetPath)
      } else {
        mkdirSync(dirname(targetPath), { recursive: true })
        copyFileSync(sourcePath, targetPath)
      }
    }

    // Clean up temp directory
    const tempDir = dirname(extractPath)
    rmSync(tempDir, { recursive: true, force: true })
  }

  /**
   * Rollback to backup
   */
  async rollback(): Promise<void> {
    if (!this.backupPath || !existsSync(this.backupPath)) {
      throw new Error('No backup available for rollback')
    }

    const toRestore = ['dist', 'package.json', 'package-lock.json']

    for (const item of toRestore) {
      const backupItem = join(this.backupPath, item)
      const targetPath = join(this.installPath, item)

      if (!existsSync(backupItem)) {
        continue
      }

      // Remove current
      if (existsSync(targetPath)) {
        rmSync(targetPath, { recursive: true, force: true })
      }

      // Restore from backup
      if (statSync(backupItem).isDirectory()) {
        this.copyRecursive(backupItem, targetPath)
      } else {
        copyFileSync(backupItem, targetPath)
      }
    }

    // Clean up backup directory
    rmSync(this.backupPath, { recursive: true, force: true })
    this.backupPath = null
  }

  /**
   * Run a shell command
   */
  private runCommand(
    command: string,
    args: string[],
    options: { cwd?: string } = {}
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        cwd: options.cwd || this.installPath,
        shell: true,
        stdio: 'pipe',
      })

      let stderr = ''

      proc.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Command "${command} ${args.join(' ')}" failed with code ${code}: ${stderr}`))
        }
      })

      proc.on('error', (err) => {
        reject(err)
      })
    })
  }

  /**
   * Recursively copy a directory
   */
  private copyRecursive(source: string, target: string): void {
    mkdirSync(target, { recursive: true })

    const items = readdirSync(source)
    for (const item of items) {
      const sourcePath = join(source, item)
      const targetPath = join(target, item)

      if (statSync(sourcePath).isDirectory()) {
        this.copyRecursive(sourcePath, targetPath)
      } else {
        copyFileSync(sourcePath, targetPath)
      }
    }
  }
}

/**
 * Get the installation path of the agent
 */
export function getInstallPath(): string {
  // When running from dist/index.js, go up two levels to get install path
  // __dirname would be /install/path/dist
  const currentFile = new URL(import.meta.url).pathname
  // Handle Windows paths
  const normalizedPath = process.platform === 'win32'
    ? currentFile.replace(/^\//, '').replace(/\//g, '\\')
    : currentFile

  // Go up from dist/upgrade/upgrader.js to install root
  return join(dirname(dirname(dirname(normalizedPath))))
}
