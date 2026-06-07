import type { HandleRegistrar } from '../dispatch'
import {
  isGitRepo, getStatus, getLogGraph, getCommitDetail,
  listBranches, listStash, stashSave, stashPop,
  checkoutBranch, gitFetch,
} from '../services/git'

export function registerGitHandlers(registrar: HandleRegistrar): void {
  registrar.handle('git:isRepo', async (_e, cwd: unknown) => isGitRepo(cwd as string | null))
  registrar.handle('git:status', async (_e, cwd: unknown) => getStatus(cwd as string))
  registrar.handle('git:logGraph', async (_e, cwd: unknown, opts?: unknown) => getLogGraph(cwd as string, (opts as { limit?: number; branch?: string }) ?? {}))
  registrar.handle('git:commitDetail', async (_e, cwd: unknown, sha: unknown) => getCommitDetail(cwd as string, sha as string))
  registrar.handle('git:branches', async (_e, cwd: unknown) => listBranches(cwd as string))
  registrar.handle('git:stashList', async (_e, cwd: unknown) => listStash(cwd as string))
  registrar.handle('git:checkout', async (_e, cwd: unknown, name: unknown) => checkoutBranch(cwd as string, name as string))
  registrar.handle('git:stashSave', async (_e, cwd: unknown, message?: unknown) => stashSave(cwd as string, message as string | undefined))
  registrar.handle('git:stashPop', async (_e, cwd: unknown, index: unknown) => stashPop(cwd as string, index as number))
  registrar.handle('git:fetch', async (_e, cwd: unknown, remote?: unknown) => gitFetch(cwd as string, remote as string | undefined))
}
