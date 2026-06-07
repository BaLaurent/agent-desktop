import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { ConversationService } from '../../core/services/conversations'
import { invalidateCwdCache } from './cwdCache'
import { invalidateSession } from './sessionManager'
import { reassignOrphanedTasks } from './scheduler'

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  const service = new ConversationService(db)

  ipcMain.handle('conversations:list', () => service.list())
  ipcMain.handle('conversations:get', (_e, id: number) => service.get(id))
  ipcMain.handle('conversations:create', (_e, title?: string, folderId?: number) => service.create(title, folderId))

  ipcMain.handle('conversations:update', (_e, id: number, data: Record<string, unknown>) => {
    const { cwdChanged } = service.update(id, data)
    if (cwdChanged) invalidateCwdCache(id)
  })

  ipcMain.handle('conversations:delete', (_e, id: number) => {
    reassignOrphanedTasks(db as any, id)
    invalidateSession(id)
    service.delete(id)
  })

  ipcMain.handle('conversations:deleteMany', (_e, ids: number[]) => {
    for (const id of ids) reassignOrphanedTasks(db as any, id)
    for (const id of ids) invalidateSession(id)
    service.deleteMany(ids)
  })

  ipcMain.handle('conversations:moveMany', (_e, ids: number[], folderId: number | null) => service.moveMany(ids, folderId))
  ipcMain.handle('conversations:colorMany', (_e, ids: number[], color: string | null) => service.colorMany(ids, color))
  ipcMain.handle('conversations:export', (_e, id: number, format: 'markdown' | 'json') => service.export(id, format))
  ipcMain.handle('conversations:import', (_e, data: string) => service.import(data))
  ipcMain.handle('conversations:search', (_e, query: string) => service.search(query))
  ipcMain.handle('conversations:fork', (_e, sourceConversationId: number, messageId: number) => service.fork(sourceConversationId, messageId))
}
