// src/lib/supabase.ts
// Browser client (singleton) and server-side client factory

import { createBrowserClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

let browserClient: ReturnType<typeof createBrowserClient> | undefined

/** Browser singleton — call from client components */
export function getSupabaseBrowser() {
  if (browserClient) return browserClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy_key'

  // ANTI-BUG: Força a remoção apenas dos LOCKS do Supabase no ambiente de desenvolvimento
  // Isso evita o loop infinito sem deslogar o usuário
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('supabase.auth.lock')
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.endsWith('-code-verifier')) {
          localStorage.removeItem(k)
        }
      }
    } catch (e) {}
  }

  browserClient = createBrowserClient(url, key)
  return browserClient
}

/** Lightweight server client — call from Server Components / Route Handlers */
export function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy_key'
  return createClient(url, key, {
    auth: { persistSession: false },
  })
}

/** Server client acting on behalf of a specific authenticated user (respects RLS) */
export function getSupabaseUserClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy_key'
  return createClient(url, key, {
    auth: { persistSession: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  })
}

/** Admin client using service role key — bypasses RLS */
export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy_key'
  return createClient(url, key, {
    auth: { persistSession: false },
  })
}

// ─── Shared Types ───────────────────────────────────────────────

export interface Profile {
  id: string
  email: string
  role: 'user' | 'sysadmin'
  plan: 'free' | 'pro' | 'max'
  credits: number
  created_at: string
  updated_at: string
  full_name?: string | null
  avatar_url?: string | null
  address?: string | null
  language?: 'pt' | 'en' | 'es' | null
  onboarding_completed: boolean
}

export interface CatalogItem {
  id: string
  title: string
  description: string | null
  type: 'hybrid_parametric' | 'image_to_3d'
  thumbnail_url: string | null
  base_glb_url: string | null
  params_schema: ParamsSchema
  price_in_credits: number
  price_free: number
  price_pro: number
  price_max: number
  is_active: boolean
  created_at: string
}

export interface FeatureCost {
  feature_key: string
  display_name: string
  cost_free: number
  cost_pro: number
  cost_max: number
  created_at: string
  updated_at: string
}

export interface ParamsSchema {
  sliders: SliderParam[]
  text_inputs: TextInputParam[]
}

export interface SliderParam {
  key: string
  label: string
  min: number
  max: number
  default: number
  unit: string
  step?: number
}

export interface TextInputParam {
  key: string
  label: string
  maxLength: number
  placeholder?: string
}

export interface SavedProject {
  id: string
  user_id: string
  item_id: string | null
  name: string
  config_state: ConfigState
  thumbnail_url: string | null
  created_at: string
  updated_at: string
}

export interface ConfigState {
  textInput?: string
  line1?: string
  line2?: string
  color?: string
  preset?: 'cookie_cutter' | 'keychain' | null
  [key: string]: unknown
}

export interface UserPricingSettings {
  user_id: string
  filament_cost_per_kg: number
  energy_cost_per_kwh: number
  printer_power_w: number
  profit_margin_percent: number
  settings_json?: any
  created_at: string
  updated_at: string
}

export interface PortfolioItem {
  id: string
  user_id: string
  title: string
  description: string | null
  thumbnail_url: string | null
  source_type: 'generated_lb' | 'makerworld' | 'manual'
  external_url: string | null
  weight_g: number
  print_time_hours: number
  calculated_price: number
  created_at: string
  updated_at: string
  metadata?: {
    creator?: { name: string; avatar: string } | null
    likeCount?: number
    downloadCount?: number
    collectionCount?: number
    printCount?: number
    license?: string
    tags?: string[]
    pictures?: string[]
  } | null
}

export interface SupportTicket {
  id: string
  user_id: string
  title: string
  description: string
  category: 'request_stl' | 'stl_adjustment' | 'other'
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  attachment_url: string | null
  created_at: string
  updated_at: string
  user_email?: string // Populated optionally in joins/views
}

export interface TicketMessage {
  id: string
  ticket_id: string
  sender_id: string
  message: string
  created_at: string
  sender_email?: string // Populated optionally in joins
  sender_role?: string  // Populated optionally in joins
}

export interface FeatureFlag {
  key: string
  display_name: string
  is_enabled: boolean
  updated_at: string
}
