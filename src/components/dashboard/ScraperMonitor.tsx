"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"
import { RefreshCw, Loader2, Settings, Shield } from "lucide-react"

interface ScraperJob {
  id: string
  file_name: string
  chat_title: string
  status: string
  file_size_bytes: number
  progress?: number
  photos?: string[]
  created_at: string
  updated_at: string
  error_message?: string
  printer_type?: string
}

type TabType = "approvals" | "history" | "settings"

export function ScraperMonitor() {
  const [scraperJobs, setScraperJobs] = useState<ScraperJob[]>([])
  const [scraperSettings, setScraperSettings] = useState<{ size_limit_mb: number; last_heartbeat?: string } | null>(null)
  const [scraperHeartbeat, setScraperHeartbeat] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>("history")
  const [selectedBans, setSelectedBans] = useState<string[]>([])
  const [dismissedPhotos, setDismissedPhotosState] = useState<string[]>([])
  const [isBanningPhotos, setIsBanningPhotos] = useState(false)

  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch("/api/jobs")
      if (!response.ok) throw new Error("Failed to fetch jobs")
      const data = await response.json()
      setScraperJobs(data.jobs || [])
    } catch (err) {
      console.error("Erro ao carregar jobs:", err)
    }
  }, [])

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch("/api/settings")
      if (!response.ok) throw new Error("Failed to fetch settings")
      const data = await response.json()
      setScraperSettings(data)
      setScraperHeartbeat(data?.last_heartbeat || null)
    } catch (err) {
      console.error("Erro ao carregar configurações:", err)
    }
  }, [])

  useEffect(() => {
    fetchJobs()
    fetchSettings()
    const interval = setInterval(() => {
      fetchJobs()
      fetchSettings()
    }, 5000)
    return () => clearInterval(interval)
  }, [fetchJobs, fetchSettings])

  const getScraperStatus = (): "healthy" | "warning" | "offline" | "unknown" => {
    if (!scraperHeartbeat) return "unknown"
    const diff = (Date.now() - new Date(scraperHeartbeat).getTime()) / 1000
    if (diff < 120) return "healthy"
    if (diff < 300) return "warning"
    return "offline"
  }

  const getTimeText = () => {
    if (!scraperHeartbeat) return ""
    const diff = Math.max(0, Math.floor((Date.now() - new Date(scraperHeartbeat).getTime()) / 1000))
    if (diff < 60) return `há ${diff}s`
    return `há ${Math.floor(diff / 60)}m`
  }

  const scraperStatus = getScraperStatus()

  const statusCounts = useMemo(() => {
    return {
      total: scraperJobs.length,
      pending: scraperJobs.filter(j => j.status === "pending").length,
      downloading: scraperJobs.filter(j => j.status === "downloading_file").length,
      uploading: scraperJobs.filter(j => j.status === "uploading_vault").length,
      indexing: scraperJobs.filter(j => j.status === "indexing").length,
      completed: scraperJobs.filter(j => j.status === "completed").length,
      failed: scraperJobs.filter(j => j.status === "failed").length,
    }
  }, [scraperJobs])

  const filteredJobs = useMemo(() => {
    if (!statusFilter) return scraperJobs
    return scraperJobs.filter(j => j.status === statusFilter)
  }, [scraperJobs, statusFilter])

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "downloading_file": return "Baixando"
      case "uploading_vault": return "Salvando"
      case "indexing": return "Indexando"
      case "completed": return "Concluído"
      case "failed": return "Falhou"
      case "pending": return "Na Fila"
      default: return status
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-indigo-500/10 border border-indigo-500/20 text-indigo-400"
      case "downloading_file": return "bg-blue-500/10 border border-blue-500/20 text-blue-400"
      case "uploading_vault": return "bg-purple-500/10 border border-purple-500/20 text-purple-400"
      case "indexing": return "bg-amber-500/10 border border-amber-500/20 text-amber-400"
      case "completed": return "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
      case "failed": return "bg-rose-500/10 border border-rose-500/20 text-rose-400"
      default: return "bg-zinc-500/10 border border-zinc-500/20 text-zinc-400"
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return (bytes / Math.pow(k, i)).toFixed(2) + " " + sizes[i]
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchJobs()
    await fetchSettings()
    setTimeout(() => setIsRefreshing(false), 500)
  }

  const handleApproveJob = async (jobId: string) => {
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", jobId })
      })
      if (!res.ok) throw new Error("Erro ao aprovar")
      await fetchJobs()
    } catch (err: any) {
      alert(`Erro ao aprovar: ${err.message}`)
    }
  }

  const handleRejectJob = async (jobId: string) => {
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", jobId })
      })
      if (!res.ok) throw new Error("Erro ao rejeitar")
      await fetchJobs()
    } catch (err: any) {
      alert(`Erro ao rejeitar: ${err.message}`)
    }
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Scraper Monitor</h1>
            <p className="text-sm text-muted-foreground">Gerenciamento de jobs, aprovações e configurações.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${
              scraperStatus === "healthy" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : scraperStatus === "warning" ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
              : scraperStatus === "offline" ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
              : "bg-zinc-500/10 border-zinc-500/20 text-zinc-400"
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                scraperStatus === "healthy" ? "bg-emerald-500 animate-pulse"
                : scraperStatus === "warning" ? "bg-amber-500"
                : scraperStatus === "offline" ? "bg-rose-500"
                : "bg-zinc-500"
              }`} />
              <span className="text-sm font-bold">
                {scraperStatus === "healthy" && `Rodando (${getTimeText()})`}
                {scraperStatus === "warning" && `Instável (${getTimeText()})`}
                {scraperStatus === "offline" && `Fora do Ar (${getTimeText()})`}
                {scraperStatus === "unknown" && "Status Desconhecido"}
              </span>
            </div>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-2 hover:bg-muted rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={20} className={`text-muted-foreground ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-8 flex gap-4 border-b border-border/40 pb-0">
          <button
            onClick={() => setActiveTab("approvals")}
            className={`px-6 py-4 font-bold text-sm transition-all border-b-2 ${
              activeTab === "approvals"
                ? "text-foreground border-b-primary"
                : "text-muted-foreground border-b-transparent hover:text-foreground"
            }`}
          >
            Aprovações e Moderação
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`px-6 py-4 font-bold text-sm transition-all border-b-2 ${
              activeTab === "history"
                ? "text-foreground border-b-primary"
                : "text-muted-foreground border-b-transparent hover:text-foreground"
            }`}
          >
            Fila e Histórico
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`px-6 py-4 font-bold text-sm transition-all border-b-2 ${
              activeTab === "settings"
                ? "text-foreground border-b-primary"
                : "text-muted-foreground border-b-transparent hover:text-foreground"
            }`}
          >
            Configurações
          </button>
        </div>

        {/* Content */}
        {activeTab === "history" && (
          <>
            {/* Status Filter */}
            <div className="mb-6 flex flex-wrap gap-2">
              <button
                onClick={() => setStatusFilter(null)}
                className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                  statusFilter === null
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "bg-muted text-foreground border border-border hover:bg-muted/80"
                }`}
              >
                Todos <span className="ml-2 text-xs opacity-70">{statusCounts.total}</span>
              </button>
              <button
                onClick={() => setStatusFilter("pending")}
                className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                  statusFilter === "pending"
                    ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                    : "bg-muted text-foreground border border-border hover:bg-muted/80"
                }`}
              >
                📋 Na Fila <span className="ml-2 text-xs opacity-70">{statusCounts.pending}</span>
              </button>
              <button
                onClick={() => setStatusFilter("downloading_file")}
                className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                  statusFilter === "downloading_file"
                    ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                    : "bg-muted text-foreground border border-border hover:bg-muted/80"
                }`}
              >
                ⬇️ Baixando <span className="ml-2 text-xs opacity-70">{statusCounts.downloading}</span>
              </button>
              <button
                onClick={() => setStatusFilter("uploading_vault")}
                className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                  statusFilter === "uploading_vault"
                    ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                    : "bg-muted text-foreground border border-border hover:bg-muted/80"
                }`}
              >
                💾 Salvando <span className="ml-2 text-xs opacity-70">{statusCounts.uploading}</span>
              </button>
              <button
                onClick={() => setStatusFilter("indexing")}
                className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                  statusFilter === "indexing"
                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    : "bg-muted text-foreground border border-border hover:bg-muted/80"
                }`}
              >
                🔍 Indexando <span className="ml-2 text-xs opacity-70">{statusCounts.indexing}</span>
              </button>
              <button
                onClick={() => setStatusFilter("completed")}
                className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                  statusFilter === "completed"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-muted text-foreground border border-border hover:bg-muted/80"
                }`}
              >
                ✅ Concluído <span className="ml-2 text-xs opacity-70">{statusCounts.completed}</span>
              </button>
              <button
                onClick={() => setStatusFilter("failed")}
                className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                  statusFilter === "failed"
                    ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                    : "bg-muted text-foreground border border-border hover:bg-muted/80"
                }`}
              >
                ❌ Falhou <span className="ml-2 text-xs opacity-70">{statusCounts.failed}</span>
              </button>
            </div>

            {/* Table */}
            <div className="border border-border rounded-2xl overflow-hidden bg-card/50">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-6 py-4 text-xs font-bold text-muted-foreground uppercase">Arquivo</th>
                      <th className="text-left px-6 py-4 text-xs font-bold text-muted-foreground uppercase">Canal / Grupo</th>
                      <th className="text-left px-6 py-4 text-xs font-bold text-muted-foreground uppercase">Tamanho</th>
                      <th className="text-left px-6 py-4 text-xs font-bold text-muted-foreground uppercase">Status</th>
                      <th className="text-left px-6 py-4 text-xs font-bold text-muted-foreground uppercase">Atualizado Em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredJobs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-sm text-muted-foreground">
                          Nenhum job encontrado
                        </td>
                      </tr>
                    ) : (
                      filteredJobs.map(job => (
                        <tr key={job.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                          <td className="px-6 py-4">
                            <div className="max-w-xs">
                              <p className="text-sm font-medium text-foreground truncate">{job.file_name}</p>
                              {job.progress ? (
                                <div className="mt-2 w-full bg-muted rounded-full h-1.5">
                                  <div
                                    className="bg-primary h-1.5 rounded-full transition-all"
                                    style={{ width: `${job.progress}%` }}
                                  />
                                </div>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm text-muted-foreground truncate">{job.chat_title}</p>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm font-mono text-foreground">{formatFileSize(job.file_size_bytes)}</p>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${getStatusColor(job.status)}`}>
                              {getStatusLabel(job.status)}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm text-muted-foreground">
                              {new Date(job.updated_at).toLocaleString("pt-BR", {
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit"
                              })}
                            </p>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Stats */}
            <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-card border border-border rounded-xl p-6">
                <p className="text-xs text-muted-foreground uppercase font-bold mb-2">Total</p>
                <p className="text-3xl font-bold text-foreground">{statusCounts.total}</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-6">
                <p className="text-xs text-muted-foreground uppercase font-bold mb-2">Em Progresso</p>
                <p className="text-3xl font-bold text-blue-400">{statusCounts.downloading + statusCounts.uploading + statusCounts.indexing}</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-6">
                <p className="text-xs text-muted-foreground uppercase font-bold mb-2">Completados</p>
                <p className="text-3xl font-bold text-emerald-400">{statusCounts.completed}</p>
              </div>
            </div>
          </>
        )}

        {activeTab === "approvals" && (
          <div className="py-12 text-center">
            <Shield size={48} className="mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground text-lg">Fila de aprovação e moderação de fotos</p>
            <p className="text-sm text-muted-foreground mt-2">Em desenvolvimento...</p>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="py-12 text-center">
            <Settings size={48} className="mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground text-lg">Configuração dos grupos Telegram</p>
            <p className="text-sm text-muted-foreground mt-2">Em desenvolvimento...</p>
          </div>
        )}
      </div>
    </div>
  )
}
