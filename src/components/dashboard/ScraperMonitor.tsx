"use client"

import React, { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { RefreshCw, Loader2 } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

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

export function ScraperMonitor() {
  const [scraperJobs, setScraperJobs] = useState<ScraperJob[]>([])
  const [scraperSettings, setScraperSettings] = useState<{ size_limit_mb: number; last_heartbeat?: string } | null>(null)
  const [scraperHeartbeat, setScraperHeartbeat] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"approvals" | "photos">("approvals")
  const [selectedJobDetails, setSelectedJobDetails] = useState<ScraperJob | null>(null)
  const [actingJobId, setActingJobId] = useState<string | null>(null)
  const [activePhotoIndex, setActivePhotoIndex] = useState(0)
  const [selectedBans, setSelectedBans] = useState<string[]>([])
  const [dismissedPhotos, setDismissedPhotosState] = useState<string[]>([])
  const [isBanningPhotos, setIsBanningPhotos] = useState(false)
  const scraperJobsRef = useRef<ScraperJob[]>([])

  const fetchJobs = useCallback(async () => {
    try {
      // Fetch from Supabase via server API route
      const response = await fetch("/api/jobs")
      if (!response.ok) throw new Error("Failed to fetch jobs")
      const data = await response.json()
      const jobs = data.jobs || []
      setScraperJobs(jobs)
      scraperJobsRef.current = jobs
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

    // Poll for updates
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

  const scraperStatus = getScraperStatus()

  const getTimeText = () => {
    if (!scraperHeartbeat) return ""
    const diff = Math.max(0, Math.floor((Date.now() - new Date(scraperHeartbeat).getTime()) / 1000))
    if (diff < 60) return `há ${diff}s`
    return `há ${Math.floor(diff / 60)}m`
  }

  const summaryBadges = {
    pending: scraperJobs.filter(j => j.status === "pending").length,
    inProgress: scraperJobs.filter(j => ["downloading_file", "uploading_vault", "indexing"].includes(j.status)).length,
    failed: scraperJobs.filter(j => j.status === "failed").length,
    completed: scraperJobs.filter(j => j.status === "completed").length,
  }

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
      case "downloading_file": return "bg-blue-500/10 border-blue-500/20 text-blue-400"
      case "uploading_vault": return "bg-purple-500/10 border-purple-500/20 text-purple-400"
      case "indexing": return "bg-amber-500/10 border-amber-500/20 text-amber-400"
      case "completed": return "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
      case "failed": return "bg-rose-500/10 border-rose-500/20 text-rose-400"
      default: return "bg-zinc-500/10 border-zinc-500/20 text-zinc-400"
    }
  }

  const handleApproveJob = useCallback(async (jobId: string) => {
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
  }, [fetchJobs])

  const handleRejectJob = useCallback(async (jobId: string) => {
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
  }, [fetchJobs])

  const handleBanPhotos = useCallback(async () => {
    if (selectedBans.length === 0) return
    if (!confirm(`Banir ${selectedBans.length} imagem(ns)?`)) return
    setIsBanningPhotos(true)

    let successCount = 0
    let failCount = 0

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
          failCount++
        }
      }

      persistDismissed([...dismissedPhotos, ...selectedBans])
      setSelectedBans([])

      if (failCount === 0) {
        alert(`${successCount} foto(s) banida(s) com sucesso!`)
      } else if (successCount === 0) {
        alert(`Falha ao banir todas as fotos.`)
      } else {
        alert(`${successCount} foto(s) banida(s). ${failCount} falharam.`)
      }
    } catch (err: any) {
      alert(`Erro ao banir: ${err.message}`)
    } finally {
      setIsBanningPhotos(false)
    }
  }, [selectedBans, dismissedPhotos])

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-screen-2xl mx-auto grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-6">
        {/* Left Column */}
        <div className="flex flex-col gap-6">
          {/* Status Card */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-base text-foreground">Status do Scraper</h3>
              <button
                onClick={() => { fetchJobs(); fetchSettings() }}
                className="p-2 hover:bg-muted rounded-lg transition-colors cursor-pointer"
              >
                <RefreshCw size={18} className="text-muted-foreground" />
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className={`h-3 w-3 rounded-full ${
                scraperStatus === "healthy" ? "bg-emerald-500 shadow-[0_0_8px_#10b981] animate-pulse"
                : scraperStatus === "warning" ? "bg-amber-500"
                : scraperStatus === "offline" ? "bg-rose-500"
                : "bg-zinc-500"
              }`} />
              <p className={`text-sm font-bold ${
                scraperStatus === "healthy" ? "text-emerald-400"
                : scraperStatus === "warning" ? "text-amber-400"
                : scraperStatus === "offline" ? "text-rose-400"
                : "text-zinc-400"
              }`}>
                {scraperStatus === "healthy" && `Servidor Ativo (${getTimeText()})`}
                {scraperStatus === "warning" && `Instável (${getTimeText()})`}
                {scraperStatus === "offline" && `Fora do Ar (${getTimeText()})`}
                {scraperStatus === "unknown" && "Status Desconhecido"}
              </p>
            </div>
          </div>

          {/* Summary Badges */}
          <div className="flex flex-wrap gap-2">
            <div className="px-3 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-bold">{summaryBadges.pending} pendentes</div>
            <div className="px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold">{summaryBadges.inProgress} em progresso</div>
            <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-bold">{summaryBadges.failed} falhas</div>
            <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold">{summaryBadges.completed} completados</div>
          </div>

          {/* Jobs em Progresso */}
          <div className="bg-card border border-border rounded-2xl p-4">
            <h3 className="font-bold text-sm text-foreground mb-3">Em Progresso</h3>
            <div className="max-h-[400px] overflow-y-auto space-y-2">
              {scraperJobs
                .filter(j => ["pending", "downloading_file", "uploading_vault", "indexing"].includes(j.status))
                .slice(0, 10)
                .map(job => (
                  <div key={job.id} className={`p-3 rounded-lg border text-xs ${getStatusColor(job.status)}`}>
                    <div className="font-mono truncate mb-1">{job.file_name}</div>
                    <div className="flex items-center justify-between">
                      <span>{getStatusLabel(job.status)}</span>
                      {typeof job.progress === "number" && job.progress > 0 && (
                        <span className="font-bold">{job.progress}%</span>
                      )}
                    </div>
                    <div className="text-[10px] opacity-70 mt-1 truncate">{job.chat_title}</div>
                  </div>
                ))}
              {scraperJobs.filter(j => ["pending", "downloading_file", "uploading_vault", "indexing"].includes(j.status)).length === 0 && (
                <p className="text-xs text-muted-foreground italic py-4 text-center">Nenhum job em progresso</p>
              )}
            </div>
          </div>

          {/* Histórico Recente */}
          <div className="bg-card border border-border rounded-2xl p-4">
            <h3 className="font-bold text-sm text-foreground mb-3">Histórico Recente</h3>
            <div className="max-h-[200px] overflow-y-auto space-y-2">
              {scraperJobs
                .filter(j => ["completed", "failed"].includes(j.status))
                .slice(0, 5)
                .map(job => (
                  <div key={job.id} className="p-2 rounded-lg border border-border bg-muted/20 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono truncate flex-1">{job.file_name}</span>
                      <span className={`ml-2 font-bold ${job.status === "completed" ? "text-emerald-400" : "text-rose-400"}`}>
                        {job.status === "completed" ? "✅" : "❌"}
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      {new Date(job.updated_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="flex flex-col gap-4">
          {/* Tabs */}
          <div className="bg-card border border-border rounded-xl p-1 flex gap-1">
            <button
              onClick={() => setActiveTab("approvals")}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === "approvals"
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              Fila de Aprovação
            </button>
            <button
              onClick={() => setActiveTab("photos")}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === "photos"
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              Moderação de Fotos
            </button>
          </div>

          {/* Tab Content */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden p-6 min-h-[400px]">
            {activeTab === "approvals" && (
              <div className="space-y-4">
                <h3 className="text-lg font-bold">Fila de Aprovação</h3>
                <div className="text-sm text-muted-foreground">
                  {scraperJobs.filter(j => j.status === "pending_approval").length === 0
                    ? "Nenhum arquivo aguardando aprovação"
                    : `${scraperJobs.filter(j => j.status === "pending_approval").length} arquivo(s) aguardando`}
                </div>
              </div>
            )}

            {activeTab === "photos" && (
              <div className="space-y-4">
                <h3 className="text-lg font-bold">Moderação de Fotos</h3>
                <div className="text-sm text-muted-foreground">
                  {dismissedPhotos.length === 0
                    ? "Nenhuma foto para moderar"
                    : `${dismissedPhotos.length} foto(s) descartada(s)`}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
