"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"
import { RefreshCw, Loader2, Settings, Shield, Trash2, Ban, Eye } from "lucide-react"

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
  const [actingJobId, setActingJobId] = useState<string | null>(null)

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
    if (typeof window === "undefined") return
    const saved = localStorage.getItem("dismissedAdminPhotos")
    if (saved) {
      try {
        setDismissedPhotosState(JSON.parse(saved))
      } catch {}
    }
  }, [])

  const persistDismissed = (next: string[]) => {
    setDismissedPhotosState(next)
    if (typeof window !== "undefined") localStorage.setItem("dismissedAdminPhotos", JSON.stringify(next))
  }

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
      pending_approval: scraperJobs.filter(j => j.status === "pending_approval").length,
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
      case "pending_approval": return "Aguardando Aprovação"
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
      case "pending_approval": return "bg-orange-500/10 border border-orange-500/20 text-orange-400"
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
    setActingJobId(jobId)
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
    } finally {
      setActingJobId(null)
    }
  }

  const handleRejectJob = async (jobId: string) => {
    setActingJobId(jobId)
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
    } finally {
      setActingJobId(null)
    }
  }

  const handleBanPhotos = async () => {
    if (selectedBans.length === 0) return
    if (!confirm(`Banir ${selectedBans.length} imagem(ns)?`)) return
    setIsBanningPhotos(true)

    let successCount = 0
    try {
      for (const key of selectedBans) {
        const pipeIdx = key.indexOf("|")
        const url = key.slice(pipeIdx + 1)
        try {
          const res = await fetch("/api/ban-images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_url: url })
          })
          if (!res.ok) throw new Error("Failed to ban image")
          successCount++
        } catch (err) {
          console.error("Erro ao banir imagem:", err)
        }
      }

      persistDismissed([...dismissedPhotos, ...selectedBans])
      setSelectedBans([])

      if (successCount === selectedBans.length) {
        alert(`${successCount} foto(s) banida(s) com sucesso!`)
      } else {
        alert(`${successCount} de ${selectedBans.length} fotos banidas.`)
      }
    } catch (err: any) {
      alert(`Erro ao banir: ${err.message}`)
    } finally {
      setIsBanningPhotos(false)
    }
  }

  const allPhotos = useMemo(() => {
    const seen = new Set<string>()
    const photos: { jobId: string; url: string; jobTitle: string }[] = []
    scraperJobs.forEach(job => {
      (job.photos || []).forEach((url: string) => {
        const key = `${job.id}|${url}`
        if (!seen.has(key) && !dismissedPhotos.includes(key)) {
          seen.add(key)
          photos.push({ jobId: job.id, url, jobTitle: job.file_name })
        }
      })
    })
    return photos
  }, [scraperJobs, dismissedPhotos])

  const pendingApprovalJobs = scraperJobs.filter(j => j.status === "pending_approval")

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
        <div className="mb-8 flex gap-4 border-b border-border/40 pb-0 flex-wrap">
          <button
            onClick={() => setActiveTab("approvals")}
            className={`px-6 py-4 font-bold text-sm transition-all border-b-2 ${
              activeTab === "approvals"
                ? "text-foreground border-b-primary"
                : "text-muted-foreground border-b-transparent hover:text-foreground"
            }`}
          >
            Aprovações e Moderação {statusCounts.pending_approval > 0 && <span className="ml-2 bg-orange-500/20 px-2 py-1 rounded text-orange-400 text-xs">{statusCounts.pending_approval}</span>}
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
          <div className="space-y-8">
            {/* Approval Queue */}
            <div>
              <h2 className="text-xl font-bold text-foreground mb-4">Fila de Aprovação</h2>
              {pendingApprovalJobs.length === 0 ? (
                <div className="border border-dashed border-border rounded-2xl p-8 text-center">
                  <p className="text-muted-foreground">Nenhum arquivo aguardando aprovação</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {pendingApprovalJobs.map(job => (
                    <div key={job.id} className="border border-border rounded-2xl overflow-hidden bg-card/50 hover:border-orange-500/30 transition-all">
                      {job.photos?.length ? (
                        <div className="relative aspect-video w-full bg-muted/50 overflow-hidden">
                          <img src={job.photos[0]} alt={job.file_name} className="w-full h-full object-cover" />
                          <div className="absolute top-3 right-3 px-3 py-1 rounded bg-black/70 backdrop-blur-sm text-xs font-bold text-orange-400">
                            {formatFileSize(job.file_size_bytes)}
                          </div>
                        </div>
                      ) : (
                        <div className="aspect-video w-full bg-muted/50 flex items-center justify-center">
                          <p className="text-muted-foreground text-sm">Sem foto</p>
                        </div>
                      )}
                      <div className="p-5">
                        <h3 className="font-bold text-sm text-foreground mb-2 line-clamp-2">{job.file_name}</h3>
                        <p className="text-xs text-muted-foreground mb-4">{job.chat_title}</p>
                        <div className="grid grid-cols-2 gap-3">
                          <button
                            onClick={() => handleApproveJob(job.id)}
                            disabled={actingJobId === job.id}
                            className="py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                          >
                            {actingJobId === job.id ? <Loader2 size={12} className="animate-spin" /> : "✅"} Aprovar
                          </button>
                          <button
                            onClick={() => handleRejectJob(job.id)}
                            disabled={actingJobId === job.id}
                            className="py-2 bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 text-rose-400 border border-rose-500/20 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                          >
                            ❌ Rejeitar
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Photo Moderation */}
            <div className="border-t border-border pt-8">
              <h2 className="text-xl font-bold text-foreground mb-4">Moderação de Fotos</h2>
              {allPhotos.length === 0 ? (
                <div className="border border-dashed border-border rounded-2xl p-8 text-center">
                  <p className="text-muted-foreground">Nenhuma foto para moderar</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <button
                      onClick={() => setSelectedBans(selectedBans.length === allPhotos.length ? [] : allPhotos.map((p, i) => `${p.jobId}|${p.url}`))}
                      className="px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground text-xs font-bold rounded-lg border border-border cursor-pointer transition-all"
                    >
                      {selectedBans.length === allPhotos.length ? "Desmarcar Todos" : "Selecionar Todos"}
                    </button>
                    {selectedBans.length > 0 && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => { persistDismissed([...dismissedPhotos, ...selectedBans]); setSelectedBans([]) }}
                          className="px-4 py-2 bg-zinc-600 hover:bg-zinc-500 text-white text-xs font-bold rounded-xl cursor-pointer transition-all flex items-center gap-2"
                        >
                          <Eye size={14} /> Ignorar ({selectedBans.length})
                        </button>
                        <button
                          onClick={handleBanPhotos}
                          disabled={isBanningPhotos}
                          className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl cursor-pointer transition-all flex items-center gap-2"
                        >
                          {isBanningPhotos ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} Banir ({selectedBans.length})
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                    {allPhotos.map((photo, idx) => {
                      const key = `${photo.jobId}|${photo.url}`
                      const isSelected = selectedBans.includes(key)
                      return (
                        <div
                          key={`${photo.jobId}-${idx}`}
                          onClick={() => setSelectedBans(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])}
                          className={`group relative aspect-square rounded-xl overflow-hidden bg-muted border-2 cursor-pointer transition-all ${
                            isSelected ? "border-red-500 scale-95" : "border-border hover:border-red-500/50"
                          }`}
                        >
                          <img
                            src={photo.url}
                            alt="photo"
                            className={`w-full h-full object-cover ${isSelected ? "opacity-80" : ""}`}
                            onError={e => {
                              (e.currentTarget as HTMLImageElement).style.display = "none"
                              const el = document.createElement("span")
                              el.className = "text-xs text-red-400 font-bold p-2 text-center absolute inset-0 flex items-center justify-center"
                              el.innerText = "Expirada"
                              e.currentTarget.parentElement?.appendChild(el)
                            }}
                          />
                          <div className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center border-2 transition-colors ${
                            isSelected ? "bg-red-500 border-red-500 text-white" : "bg-black/50 border-white/50 opacity-0 group-hover:opacity-100"
                          }`}>
                            {isSelected && "✓"}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="space-y-8">
            {/* Limits */}
            <div>
              <h2 className="text-xl font-bold text-foreground mb-4">Limites de Tamanho</h2>
              <div className="bg-card border border-border rounded-2xl p-6">
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-bold text-foreground block mb-2">Limite de arquivo (MB)</label>
                    <input
                      type="number"
                      defaultValue={scraperSettings?.size_limit_mb || 750}
                      disabled
                      className="w-full px-4 py-2 rounded-lg border border-border bg-muted/30 text-foreground text-sm disabled:opacity-50"
                    />
                    <p className="text-xs text-muted-foreground mt-2">Arquivos acima deste limite aguardam aprovação</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Activity */}
            <div>
              <h2 className="text-xl font-bold text-foreground mb-4">Atividade do Scraper</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-card border border-border rounded-2xl p-6">
                  <p className="text-xs text-muted-foreground uppercase font-bold mb-2">Último Heartbeat</p>
                  <p className="text-lg font-bold text-foreground">
                    {scraperHeartbeat ? new Date(scraperHeartbeat).toLocaleString("pt-BR") : "N/A"}
                  </p>
                </div>
                <div className="bg-card border border-border rounded-2xl p-6">
                  <p className="text-xs text-muted-foreground uppercase font-bold mb-2">Jobs Processados</p>
                  <p className="text-lg font-bold text-foreground">{statusCounts.total}</p>
                </div>
              </div>
            </div>

            {/* Info */}
            <div>
              <h2 className="text-xl font-bold text-foreground mb-4">Informações</h2>
              <div className="bg-card border border-border rounded-2xl p-6 text-sm text-muted-foreground space-y-2">
                <p>✅ <strong>Pollingde status:</strong> 5 segundos</p>
                <p>✅ <strong>Sincronização Supabase:</strong> Realtime com websocket</p>
                <p>✅ <strong>Storage:</strong> Vault + Supabase</p>
                <p>✅ <strong>Moderation:</strong> Hash perceptual para foto-ban</p>
                <p className="text-xs text-muted-foreground/70 mt-4">Dashboard versão 1.0 • Atualizado em tempo real</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
