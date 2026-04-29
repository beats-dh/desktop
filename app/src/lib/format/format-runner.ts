// Runs the registered code formatters on a set of files inside a repo.
// Invoked by AppStore right before a commit is created when the user has
// `formatOnCommit` enabled in Preferences. Failures are non-fatal — we log
// and report which files were skipped so the commit can still go through.

import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { isAbsolute, join } from 'path'

import {
  FORMAT_TOOLS,
  FormatTool,
  JsModuleFormatTool,
  SpawnFormatTool,
  getFormatToolForFile,
  repoHasToolConfig,
} from './format-language'

export interface FormatResult {
  /** Files whose contents were rewritten by a formatter. */
  readonly formatted: ReadonlyArray<string>
  /**
   * Files we considered but didn't touch — paired with a reason so the UI
   * can surface "skipped: no .clang-format in repo" instead of failing
   * silently.
   */
  readonly skipped: ReadonlyArray<{
    readonly path: string
    readonly reason: string
  }>
}

function spawnTool(
  bin: string,
  args: ReadonlyArray<string>,
  cwd: string
): Promise<{ status: number; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(bin, [...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stderr = ''
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', err => {
      resolve({ status: 1, stderr: err.message })
    })
    child.on('close', code => {
      resolve({ status: code ?? 1, stderr })
    })
  })
}

async function runSpawnTool(
  tool: SpawnFormatTool,
  files: ReadonlyArray<string>,
  repoPath: string,
  formatted: string[],
  skipped: Array<{ path: string; reason: string }>
): Promise<void> {
  const bin = await tool.resolveBin()
  if (bin === null || !existsSync(bin)) {
    for (const f of files) {
      skipped.push({
        path: f,
        reason: `${tool.displayName} binary not bundled`,
      })
    }
    return
  }

  const { status, stderr } = await spawnTool(
    bin,
    tool.buildArgs(files),
    repoPath
  )
  if (status === 0) {
    formatted.push(...files)
  } else {
    log.warn(`[format] ${tool.id} exited with ${status}: ${stderr.trim()}`)
    for (const f of files) {
      skipped.push({
        path: f,
        reason: `${tool.displayName} failed (exit ${status})`,
      })
    }
  }
}

async function runJsModuleTool(
  tool: JsModuleFormatTool,
  files: ReadonlyArray<string>,
  repoPath: string,
  formatted: string[],
  skipped: Array<{ path: string; reason: string }>
): Promise<void> {
  for (const file of files) {
    const absPath = isAbsolute(file) ? file : join(repoPath, file)
    try {
      const ok = await tool.formatFile(absPath, repoPath)
      if (ok) {
        formatted.push(file)
      } else {
        skipped.push({
          path: file,
          reason: `${tool.displayName} ignored the file`,
        })
      }
    } catch (err: any) {
      log.warn(
        `[format] ${tool.id} threw on ${file}: ${err?.message ?? err}`
      )
      skipped.push({
        path: file,
        reason: `${tool.displayName} threw: ${err?.message ?? 'unknown'}`,
      })
    }
  }
}

/**
 * Format the given files in place inside the given repo, in parallel by tool.
 * Files for tools whose binary or repo-config is missing are skipped with a
 * reason — we never block the caller, who is expected to commit either way.
 */
export async function formatFilesInRepo(
  repoPath: string,
  filePaths: ReadonlyArray<string>
): Promise<FormatResult> {
  const formatted: string[] = []
  const skipped: Array<{ path: string; reason: string }> = []

  // Bucket each file by which tool handles it.
  const buckets = new Map<FormatTool, string[]>()
  for (const path of filePaths) {
    const tool = getFormatToolForFile(path)
    if (tool === null) {
      continue
    }
    const list = buckets.get(tool) ?? []
    list.push(path)
    buckets.set(tool, list)
  }

  if (buckets.size === 0) {
    return { formatted, skipped }
  }

  const tasks: Array<Promise<void>> = []

  for (const [tool, files] of buckets) {
    if (!repoHasToolConfig(repoPath, tool)) {
      for (const f of files) {
        skipped.push({
          path: f,
          reason: `no ${tool.displayName} config in repo`,
        })
      }
      continue
    }

    if (tool.kind === 'spawn') {
      tasks.push(runSpawnTool(tool, files, repoPath, formatted, skipped))
    } else {
      tasks.push(runJsModuleTool(tool, files, repoPath, formatted, skipped))
    }
  }

  await Promise.all(tasks)
  return { formatted, skipped }
}

/** Re-export tool registry for callers that need it (UI, tests). */
export { FORMAT_TOOLS }
