import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import dayjs from 'dayjs'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import {
  BarChart3, CalendarRange, Download, Edit, Factory, Filter, Hammer, LogIn, LogOut,
  Mail, Plus, RefreshCw, Save, Search, Trash2, Upload, Cloud, Database, FileText,
  QrCode, Share2, Send
} from 'lucide-react'
import {
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  Bar, ComposedChart, Line
} from 'recharts'
import KPI from '@/components/KPI'
import ClockIcon from '@/components/ClockIcon'
import Message from '@/components/Message'

// ------------------------------
// Utilidades & Constantes
// ------------------------------
const STORAGE_KEY = 'prado_mineracao_producao_vite_v2'
const STORAGE_PENDING = 'prado_mineracao_pending_queue_v2'

function uid(){ return Math.random().toString(36).slice(2) + Date.now().toString(36) }
function parseTimeToHours(start, end){
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins < 0) mins += 24 * 60
  return +(mins / 60).toFixed(2)
}
function formatNumber(n, frac=2){
  if (n === undefined || n === null || isNaN(n)) return '0'
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: frac }).format(Number(n))
}

// Cores fixas para equipamentos solicitados e fallback automático
const EQUIP_COLORS = {
  'MM-01': '#facc15', // amarelo
  'MM-02': '#f97316', // laranja
  'BT-01': '#22c55e', // verde
}
const PALETTE = ['#60a5fa','#a78bfa','#34d399','#f472b6','#f59e0b','#10b981','#ef4444','#14b8a6','#8b5cf6','#e11d48']
function colorForEquipment(name, idx){
  const key = (name || '').toUpperCase()
  if (EQUIP_COLORS[key]) return EQUIP_COLORS[key]
  return PALETTE[idx % PALETTE.length]
}

// ------------------------------
// Supabase Client (Vite env)
// ------------------------------
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
const supabase = (SUPABASE_URL && SUPABASE_ANON) ? createClient(SUPABASE_URL, SUPABASE_ANON) : null

export default function App(){
  const [entries, setEntries] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [session, setSession] = useState(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [msg, setMsg] = useState('')

  // filtros & relatórios
  const today = dayjs().format('YYYY-MM-DD')
  const [form, setForm] = useState({
    date: today, start: '07:00', end: '19:00', shift: 'Diurno',
    stage: 'Britagem', equipment: '', tonnage: '', moisture: '',
    operator: '', notes: '',
    // novos campos:
    downtime_min: '', downtime_cause: '', tph_target: '', grade: '',
  })
  const [filters, setFilters] = useState({
    from: today, to: today, stage: 'Todos', query: '',
  })
  const [reportDate, setReportDate] = useState(today)
  const [reportMonth, setReportMonth] = useState(dayjs().format('YYYY-MM')) // input type="month"

  const emailRef = useRef(null)

  // QR states
  const [qrOpen, setQrOpen] = useState(false)
  const qrInstanceRef = useRef(null)

  // Local load/save
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setEntries(JSON.parse(raw))
    } catch (e) { console.error(e) }
  }, [])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  }, [entries])

  // Auth
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess)
      if (sess) fetchCloudEntries(sess.user.id)
    })
    return () => { sub?.subscription.unsubscribe() }
  }, [])

  // Cloud
  async function fetchCloudEntries(userId){
    if (!supabase || !userId) return
    const { data, error } = await supabase.from('production_entries').select('*').order('date', { ascending: true })
    if (error) { setMsg('Falha ao carregar dados da nuvem.'); return }
    const cloud = (data || []).map(mapFromCloud)
    setEntries(prev => mergeById(prev, cloud))
  }
  function mergeById(a, b){
    const map = new Map(); [...a, ...b].forEach(x => map.set(x.id, { ...map.get(x.id), ...x }))
    return Array.from(map.values()).sort((x,y) => x.date < y.date ? -1 : 1)
  }
  function queuePending(op){
    const raw = localStorage.getItem(STORAGE_PENDING)
    const list = raw ? JSON.parse(raw) : []
    list.push(op)
    localStorage.setItem(STORAGE_PENDING, JSON.stringify(list))
  }
  async function flushPending(){
    if (!supabase || !session?.user) return
    const raw = localStorage.getItem(STORAGE_PENDING)
    const list = raw ? JSON.parse(raw) : []
    if (!list.length) return
    setIsSyncing(true)
    try{
      for (const op of list){
        if (op.type === 'upsert') await upsertCloud(op.payload)
        else if (op.type === 'delete') await deleteCloud(op.id)
      }
      localStorage.removeItem(STORAGE_PENDING)
      setMsg('Pendências sincronizadas.')
    } finally { setIsSyncing(false) }
  }
  useEffect(() => {
    const onOnline = () => flushPending()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [session])

  function mapToCloud(e){
    const user_id = session?.user?.id || null
    return {
      id: e.id, user_id, date: e.date, start: e.start || null, end: e.end || null, shift: e.shift || null,
      stage: e.stage, equipment: e.equipment || null, tonnage: e.tonnage ?? null, moisture: e.moisture ?? null,
      operator: e.operator || null, notes: e.notes || null, hours: e.hours ?? null, tph: e.tph ?? null,
      // novos campos
      downtime_min: e.downtime_min ?? null,
      downtime_cause: e.downtime_cause || null,
      tph_target: e.tph_target ?? null,
      grade: e.grade ?? null,
    }
  }
  function mapFromCloud(r){
    return {
      id: r.id, date: r.date, start: r.start || '', end: r.end || '', shift: r.shift || '', stage: r.stage,
      equipment: r.equipment || '', tonnage: Number(r.tonnage ?? 0),
      moisture: r.moisture != null ? Number(r.moisture) : undefined,
      operator: r.operator || '', notes: r.notes || '',
      hours: r.hours != null ? Number(r.hours) : undefined,
      tph: r.tph != null ? Number(r.tph) : undefined,
      // novos campos
      downtime_min: r.downtime_min != null ? Number(r.downtime_min) : undefined,
      downtime_cause: r.downtime_cause || '',
      tph_target: r.tph_target != null ? Number(r.tph_target) : undefined,
      grade: r.grade != null ? Number(r.grade) : undefined,
      createdAt: r.created_at || undefined,
    }
  }
  async function upsertCloud(localEntry){
    if (!supabase || !session?.user) return
    const payload = mapToCloud(localEntry)
    const { error } = await supabase.from('production_entries').upsert(payload)
    if (error) throw error
  }
  async function deleteCloud(id){
    if (!supabase || !session?.user) return
    const { error } = await supabase.from('production_entries').delete().eq('id', id)
    if (error) throw error
  }

  function resetForm(){
    setForm({
      date: dayjs().format('YYYY-MM-DD'), start: '07:00', end: '19:00', shift: 'Diurno',
      stage: 'Britagem', equipment: '', tonnage: '', moisture: '', operator: '', notes: '',
      downtime_min: '', downtime_cause: '', tph_target: '', grade: '',
    })
    setEditingId(null)
  }

  async function handleSubmit(e){
    e.preventDefault()
    const hours = parseTimeToHours(form.start, form.end)
    const tonnage = Number(form.tonnage || 0)
    const downtimeMin = form.downtime_min !== '' ? Number(form.downtime_min) : 0
    const opHours = Math.max(0, hours - (downtimeMin/60))
    const tph = hours > 0 ? +(tonnage / hours).toFixed(2) : undefined
    const tphOperational = opHours > 0 ? +(tonnage / opHours).toFixed(2) : undefined

    const payload = {
      id: editingId || uid(),
      date: form.date, start: form.start, end: form.end, shift: form.shift, stage: form.stage,
      equipment: form.equipment?.trim(), tonnage,
      moisture: form.moisture !== '' ? Number(form.moisture) : undefined,
      operator: form.operator?.trim(), notes: form.notes?.trim(),
      hours, tph, createdAt: editingId ? undefined : new Date().toISOString(),
      // novos
      downtime_min: form.downtime_min !== '' ? Number(form.downtime_min) : undefined,
      downtime_cause: form.downtime_cause?.trim() || '',
      tph_target: form.tph_target !== '' ? Number(form.tph_target) : undefined,
      grade: form.grade !== '' ? Number(form.grade) : undefined,
      // derivados
      op_hours: opHours,
      tph_operational: tphOperational,
      tph_delta: (form.tph_target && tphOperational) ? +(tphOperational - Number(form.tph_target)).toFixed(2) : undefined,
    }

    setEntries(prev => {
      const exists = prev.find(x => x.id === payload.id)
      const merged = exists ? prev.map(x => x.id === payload.id ? { ...exists, ...payload } : x) : [...prev, payload]
      return merged
    })

    try {
      if (supabase && session?.user) await upsertCloud(payload)
      else queuePending({ type: 'upsert', payload })
      setMsg(editingId ? 'Lançamento atualizado.' : 'Lançamento adicionado.')
    } catch (_) {
      queuePending({ type: 'upsert', payload })
      setMsg('Sem conexão. Salvo localmente para sincronizar depois.')
    }

    resetForm()
  }

  async function handleDelete(id){
    setEntries(prev => prev.filter(x => x.id !== id))
    if (editingId === id) resetForm()
    try {
      if (supabase && session?.user) await deleteCloud(id)
      else queuePending({ type: 'delete', id })
      setMsg('Lançamento removido.')
    } catch (_){
      queuePending({ type: 'delete', id })
      setMsg('Sem conexão. Remoção pendente para sincronizar.')
    }
  }

  function handleEdit(id){
    const e = entries.find(x => x.id === id)
    if (!e) return
    setEditingId(id)
    setForm({
      date: e.date, start: e.start || '07:00', end: e.end || '19:00',
      shift: e.shift || 'Diurno', stage: e.stage,
      equipment: e.equipment || '', tonnage: e.tonnage?.toString() || '',
      moisture: e.moisture?.toString() || '', operator: e.operator || '', notes: e.notes || '',
      downtime_min: e.downtime_min?.toString() || '', downtime_cause: e.downtime_cause || '',
      tph_target: e.tph_target?.toString() || '', grade: e.grade?.toString() || '',
    })
  }

  function exportCSV(){
    const header = ['id','data','inicio','fim','turno','etapa','equipamento','toneladas','umidade_%','operador','observacoes','horas','t/h','paradas_min','causa','t/h_meta','teor_g_t','h_oper','t/h_oper','desvio','criado_em']
    const rows = entries.map(e => [
      e.id, e.date, e.start || '', e.end || '', e.shift || '', e.stage, e.equipment || '',
      e.tonnage ?? '', e.moisture ?? '', e.operator || '', (e.notes || '').replaceAll('\n',' '),
      e.hours ?? '', e.tph ?? '', e.downtime_min ?? '', e.downtime_cause || '', e.tph_target ?? '', e.grade ?? '',
      e.op_hours ?? '', e.tph_operational ?? '', e.tph_delta ?? '', e.createdAt || ''
    ])
    const csv = [header, ...rows].map(r => r.map(c => c==null? '' : String(c)).map(c => `"${c.replaceAll('"','""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `producao_${dayjs().format('YYYY-MM-DD')}.csv`; a.click(); URL.revokeObjectURL(url)
  }
  function backupJSON(){
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `backup_producao_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.json`; a.click(); URL.revokeObjectURL(url)
  }
  function importJSON(file){
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result)
        if (!Array.isArray(data)) throw new Error('Formato inválido')
        setEntries(data); setMsg('Backup importado com sucesso.')
      } catch (e) { setMsg('Falha ao importar JSON.') }
    }
    reader.readAsText(file)
  }

  // -------- Filtros e agregações ----------
  const filtered = useMemo(() => {
    const from = filters.from ? dayjs(filters.from) : null
    const to = filters.to ? dayjs(filters.to) : null
    return entries.filter((e) => {
      const d = dayjs(e.date)
      const matchDate = (!from || !d.isBefore(from)) && (!to || !d.isAfter(to))
      const matchStage = filters.stage === 'Todos' || e.stage === filters.stage
      const q = (filters.query || '').toLowerCase()
      const matchQ = !q || [e.operator, e.equipment, e.notes, e.shift].some(x => (x || '').toLowerCase().includes(q))
      return matchDate && matchStage && matchQ
    }).sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
  }, [entries, filters])

  const kpis = useMemo(() => {
    const todayStr = dayjs().format('YYYY-MM-DD')
    const monthStr = dayjs().format('YYYY-MM')
    const sum = (arr, fn) => arr.reduce((acc, x) => acc + (fn(x) || 0), 0)
    const total = sum(filtered, x => x.tonnage)
    const totalBrit = sum(filtered.filter(x => x.stage === 'Britagem'), x => x.tonnage)
    const totalMoag = sum(filtered.filter(x => x.stage === 'Moagem'), x => x.tonnage)
    const todayT = sum(entries.filter(x => x.date === todayStr), x => x.tonnage)
    const monthT = sum(entries.filter(x => String(x.date).startsWith(monthStr)), x => x.tonnage)
    return { total, totalBrit, totalMoag, todayT, monthT }
  }, [entries, filtered])

  // Produção por dia (Moagem x Britagem)
  const dailyStageBars = useMemo(() => {
    const map = new Map()
    for (const e of filtered){
      if (!map.has(e.date)) map.set(e.date, { date: e.date, Britagem: 0, Moagem: 0 })
      map.get(e.date)[e.stage] += e.tonnage || 0
    }
    return Array.from(map.values()).sort((a,b) => a.date < b.date ? -1 : 1)
  }, [filtered])

  // t/h operacional diário por etapa (usa op_hours)
  const tphOperationalSeries = useMemo(() => {
    const map = new Map()
    for (const e of filtered){
      if (!map.has(e.date)) map.set(e.date, { date: e.date, Britagem: {t:0,h:0}, Moagem: {t:0,h:0} })
      const m = map.get(e.date)
      const oh = e.op_hours ?? Math.max(0, (e.hours||0) - ((e.downtime_min||0)/60))
      if (e.stage === 'Britagem'){ m.Britagem.t += e.tonnage||0; m.Britagem.h += oh }
      if (e.stage === 'Moagem'){ m.Moagem.t += e.tonnage||0; m.Moagem.h += oh }
    }
    return Array.from(map.entries()).map(([d,v])=>({
      date: d,
      't/h Britagem': v.Britagem.h>0 ? +(v.Britagem.t / v.Britagem.h).toFixed(2) : 0,
      't/h Moagem': v.Moagem.h>0 ? +(v.Moagem.t / v.Moagem.h).toFixed(2) : 0,
    })).sort((a,b)=>a.date<b.date?-1:1)
  }, [filtered])

  // Moagem: Diurno x Noturno por dia
  const moagemShiftBars = useMemo(() => {
    const map = new Map()
    for (const e of filtered.filter(x => x.stage === 'Moagem')){
      if (!map.has(e.date)) map.set(e.date, { date: e.date, Diurno: 0, Noturno: 0 })
      if (String(e.shift).toLowerCase().includes('not')) map.get(e.date).Noturno += e.tonnage||0
      else map.get(e.date).Diurno += e.tonnage||0
    }
    return Array.from(map.values()).sort((a,b)=>a.date<b.date?-1:1)
  }, [filtered])

  // Empilhado por equipamento (Moagem e Britagem)
  function stackedByEquipment(stageName){
    const map = new Map() // date -> {date, <equip1>:t, <equip2>:t, ...}
    const eqIndex = new Map() // order by first appearance
    let idx = 0
    for (const e of filtered.filter(x => x.stage === stageName)){
      const k = e.date
      if (!map.has(k)) map.set(k, { date: k })
      const key = (e.equipment || 'N/D').toUpperCase()
      if (!eqIndex.has(key)) eqIndex.set(key, idx++)
      map.get(k)[key] = (map.get(k)[key] || 0) + (e.tonnage || 0)
    }
    const dates = Array.from(map.values()).sort((a,b)=>a.date<b.date?-1:1)
    const equipList = Array.from(eqIndex.keys())
    return { data: dates, equipList }
  }
  const { data: moagemStack, equipList: moagemEquipList } = useMemo(()=>stackedByEquipment('Moagem'), [filtered])
  const { data: britagemStack, equipList: britagemEquipList } = useMemo(()=>stackedByEquipment('Britagem'), [filtered])

  // -------- PDFs (HTML render) ----------
  function renderDailyHTML(dateStr){
    const data = entries.filter(e => e.date === dateStr)
    const sum = (arr, fn) => arr.reduce((acc, x) => acc + (fn(x) || 0), 0)
    const total = sum(data, x=>x.tonnage)
    const brit = sum(data.filter(x=>x.stage==='Britagem'), x=>x.tonnage)
    const moag = sum(data.filter(x=>x.stage==='Moagem'), x=>x.tonnage)
    const diurno = sum(data.filter(x=>x.stage==='Moagem' && !String(x.shift).toLowerCase().includes('not')), x=>x.tonnage)
    const noturno = sum(data.filter(x=>x.stage==='Moagem' && String(x.shift).toLowerCase().includes('not')), x=>x.tonnage)

    const byEquip = {}
    for(const e of data){
      const k = `${e.stage} - ${(e.equipment||'N/D').toUpperCase()}`
      byEquip[k] = (byEquip[k]||0) + (e.tonnage||0)
    }

    return `
      <div style="font-family: Arial, sans-serif; padding: 12px; width: 800px;">
        <h2>Relatório Diário – ${dayjs(dateStr).format('DD/MM/YYYY')}</h2>
        <div><b>Prado Mineração</b></div>
        <hr/>
        <p><b>Total do dia:</b> ${formatNumber(total)} t | <b>Britagem:</b> ${formatNumber(brit)} t | <b>Moagem:</b> ${formatNumber(moag)} t</p>
        <p><b>Moagem – Diurno:</b> ${formatNumber(diurno)} t | <b>Noturno:</b> ${formatNumber(noturno)} t</p>
        <h3 style="margin-top:12px;">Por Equipamento</h3>
        <table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse; width:100%;">
          <tr><th>Etapa • Equipamento</th><th style="text-align:right">t</th></tr>
          ${Object.entries(byEquip).map(([k,v])=>`<tr><td>${k}</td><td style="text-align:right">${formatNumber(v)}</td></tr>`).join('')}
        </table>
      </div>
    `
  }
  function renderMonthlyHTML(ym){ // 'YYYY-MM'
    const data = entries.filter(e => String(e.date).startsWith(ym))
    const sum = (arr, fn) => arr.reduce((acc, x) => acc + (fn(x) || 0), 0)
    const total = sum(data, x=>x.tonnage)
    const brit = sum(data.filter(x=>x.stage==='Britagem'), x=>x.tonnage)
    const moag = sum(data.filter(x=>x.stage==='Moagem'), x=>x.tonnage)

    const byDay = {}
    for(const e of data){
      if(!byDay[e.date]) byDay[e.date] = { Britagem:0, Moagem:0 }
      byDay[e.date][e.stage] += e.tonnage||0
    }

    return `
      <div style="font-family: Arial, sans-serif; padding: 12px; width: 820px;">
        <h2>Relatório Mensal – ${dayjs(ym+'-01').format('MM/YYYY')}</h2>
        <div><b>Prado Mineração</b></div>
        <hr/>
        <p><b>Total do mês:</b> ${formatNumber(total)} t | <b>Britagem:</b> ${formatNumber(brit)} t | <b>Moagem:</b> ${formatNumber(moag)} t</p>
        <h3 style="margin-top:12px;">Diário (Britagem x Moagem)</h3>
        <table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse; width:100%;">
          <tr><th>Data</th><th style="text-align:right">Britagem (t)</th><th style="text-align:right">Moagem (t)</th></tr>
          ${Object.entries(byDay).sort(([a],[b])=>a<b?-1:1).map(([d,v])=>
            `<tr><td>${dayjs(d).format('DD/MM')}</td><td style="text-align:right">${formatNumber(v.Britagem)}</td><td style="text-align:right">${formatNumber(v.Moagem)}</td></tr>`
          ).join('')}
        </table>
      </div>
    `
  }

  // -------- Helpers de PDF e Compartilhamento ----------
  function downloadBlob(blob, filename){
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  async function htmlToPDFBlob(html){
    const wrapper = document.createElement('div')
    wrapper.innerHTML = html
    document.body.appendChild(wrapper)

    const canvas = await html2canvas(wrapper, { scale: 2 })
    const img = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p','mm','a4')
    const pdfW = pdf.internal.pageSize.getWidth()
    const pdfH = (canvas.height * pdfW) / canvas.width
    pdf.addImage(img, 'PNG', 0, 0, pdfW, pdfH)
    const blob = pdf.output('blob')

    document.body.removeChild(wrapper)
    return blob
  }

  async function shareFileOrDownload({ blob, filename, title, text, fallbackWhatsApp=false }){
    const file = new File([blob], filename, { type: 'application/pdf' })

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title, text })
      return
    }

    // Fallback: baixa o PDF e abre o app/alvo sem anexo automático
    downloadBlob(blob, filename)

    if (fallbackWhatsApp) {
      const msg = text || 'Envio do relatório em PDF. Anexar o arquivo baixado.'
      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
    } else {
      const subject = title || 'Relatório'
      const body = (text ? text + '\n\n' : '') + `Caso não apareça anexado automaticamente, selecione o arquivo ${filename} que acabou de ser baixado.`
      window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    }
  }

  async function exportDailyPDF(){
    const wrapper = document.createElement('div')
    wrapper.innerHTML = renderDailyHTML(reportDate)
    document.body.appendChild(wrapper)
    const canvas = await html2canvas(wrapper, { scale: 2 })
    const img = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p','mm','a4')
    const pdfW = pdf.internal.pageSize.getWidth()
    const pdfH = (canvas.height * pdfW) / canvas.width
    pdf.addImage(img, 'PNG', 0, 0, pdfW, pdfH)
    pdf.save(`relatorio_diario_${reportDate}.pdf`)
    document.body.removeChild(wrapper)
  }
  async function exportMonthlyPDF(){
    const wrapper = document.createElement('div')
    wrapper.innerHTML = renderMonthlyHTML(reportMonth)
    document.body.appendChild(wrapper)
    const canvas = await html2canvas(wrapper, { scale: 2 })
    const img = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p','mm','a4')
    const pdfW = pdf.internal.pageSize.getWidth()
    const pdfH = (canvas.height * pdfW) / canvas.width
    pdf.addImage(img, 'PNG', 0, 0, pdfW, pdfH)
    pdf.save(`relatorio_mensal_${reportMonth}.pdf`)
    document.body.removeChild(wrapper)
  }

  // Compartilhar (WhatsApp / E-mail)
  async function sendDailyWhatsApp(){
    const html = renderDailyHTML(reportDate)
    const blob = await htmlToPDFBlob(html)
    await shareFileOrDownload({
      blob,
      filename: `relatorio_diario_${reportDate}.pdf`,
      title: `Relatório Diário ${dayjs(reportDate).format('DD/MM/YYYY')}`,
      text: `Relatório Diário ${dayjs(reportDate).format('DD/MM/YYYY')}`,
      fallbackWhatsApp: true
    })
  }
  async function sendDailyEmail(){
    const html = renderDailyHTML(reportDate)
    const blob = await htmlToPDFBlob(html)
    await shareFileOrDownload({
      blob,
      filename: `relatorio_diario_${reportDate}.pdf`,
      title: `Relatório Diário ${dayjs(reportDate).format('DD/MM/YYYY')}`,
      text: `Segue relatório diário ${dayjs(reportDate).format('DD/MM/YYYY')} em PDF.`
    })
  }
  async function sendMonthlyWhatsApp(){
    const html = renderMonthlyHTML(reportMonth)
    const blob = await htmlToPDFBlob(html)
    await shareFileOrDownload({
      blob,
      filename: `relatorio_mensal_${reportMonth}.pdf`,
      title: `Relatório Mensal ${dayjs(reportMonth+'-01').format('MM/YYYY')}`,
      text: `Relatório Mensal ${dayjs(reportMonth+'-01').format('MM/YYYY')}`,
      fallbackWhatsApp: true
    })
  }
  async function sendMonthlyEmail(){
    const html = renderMonthlyHTML(reportMonth)
    const blob = await htmlToPDFBlob(html)
    await shareFileOrDownload({
      blob,
      filename: `relatorio_mensal_${reportMonth}.pdf`,
      title: `Relatório Mensal ${dayjs(reportMonth+'-01').format('MM/YYYY')}`,
      text: `Segue relatório mensal ${dayjs(reportMonth+'-01').format('MM/YYYY')} em PDF.`
    })
  }

  // -------- QR Code (equipamento) ----------
  async function openQR(){
    setQrOpen(true)
    setTimeout(initQR, 0)
  }
  async function initQR(){
    try{
      const { Html5Qrcode } = await import('html5-qrcode')
      qrInstanceRef.current = new Html5Qrcode('qr-reader')
      await qrInstanceRef.current.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          setForm(prev => ({ ...prev, equipment: decodedText.trim() }))
          closeQR()
        },
        (_err) => {}
      )
    } catch (e){
      setMsg('Não foi possível acessar a câmera. Verifique permissões e HTTPS.')
      setQrOpen(false)
    }
  }
  function closeQR(){
    const inst = qrInstanceRef.current
    if (inst) {
      inst.stop().then(() => inst.clear()).catch(()=>{})
      qrInstanceRef.current = null
    }
    setQrOpen(false)
  }

  // -------- UI --------
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Message text={msg} onClose={() => setMsg('')} />
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-3">
          <div className="p-2 rounded-xl bg-slate-100"><Factory className="h-6 w-6" /></div>
          <div className="flex-1">
            <h1 className="text-xl md:text-2xl font-bold leading-tight">Lançamentos de Produção – Mineração</h1>
            <p className="text-sm text-slate-500">Registre Britagem e Moagem. Offline-first + Supabase + PDF + QR.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-2 border rounded-md text-sm hover:bg-slate-50" onClick={exportCSV}><Download className="inline mr-2 h-4 w-4"/>CSV</button>
            <button className="px-3 py-2 border rounded-md text-sm hover:bg-slate-50" onClick={backupJSON}><Save className="inline mr-2 h-4 w-4"/>Backup</button>
            <label className="inline-flex items-center gap-2 px-4 py-2 border rounded-md text-sm cursor-pointer hover:bg-slate-50">
              <Upload className="h-4 w-4"/> Importar
              <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importJSON(e.target.files[0])} />
            </label>
            <button className="px-3 py-2 rounded-md text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60" onClick={flushPending} disabled={isSyncing}><Cloud className="inline mr-2 h-4 w-4"/>{isSyncing ? 'Sincronizando...' : 'Sincronizar'}</button>
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-4 pb-3 flex items-center justify-between gap-3">
          {session?.user ? (
            <div className="text-sm text-slate-600 flex items-center gap-3">
              <Database className="h-4 w-4"/>
              <span>Conectado: <b>{session.user.email || session.user.id}</b></span>
              <button className="px-3 py-2 border rounded-md text-sm hover:bg-slate-50" onClick={async()=>{ await supabase.auth.signOut(); setSession(null) }}><LogOut className="inline mr-2 h-4 w-4"/>Sair</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-slate-400"/>
              <input ref={emailRef} type="email" placeholder="seu@email.com" className="w-64 px-3 py-2 border rounded-md"/>
              <button className="px-3 py-2 rounded-md text-white bg-slate-900 hover:bg-slate-800" onClick={async()=>{
                if (!supabase) { setMsg('Configure as variáveis do Supabase para autenticar.'); return }
                const email = emailRef.current?.value?.trim()
                if (!email) return setMsg('Informe um e-mail válido.')
                const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } })
                if (error) return setMsg('Falha ao enviar link. Verifique o e-mail.')
                setMsg('Link de acesso enviado ao e-mail.')
              }}><LogIn className="inline mr-2 h-4 w-4"/>Entrar por e-mail</button>
              {(!SUPABASE_URL || !SUPABASE_ANON) ? (<span className="text-xs text-amber-600 ml-2">Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY</span>) : null}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Formulário */}
        <div className="rounded-2xl border bg-white shadow-sm p-4">
          <div className="text-lg font-semibold flex items-center gap-2 mb-3"><Plus className="h-5 w-5"/> Novo Lançamento</div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-sm">Data</label><input type="date" className="w-full px-3 py-2 border rounded-md" value={form.date} onChange={e=>setForm({...form, date:e.target.value})} required /></div>
              <div><label className="text-sm">Turno</label><select className="w-full px-3 py-2 border rounded-md" value={form.shift} onChange={e=>setForm({...form, shift:e.target.value})}><option>Diurno</option><option>Noturno</option><option>A</option><option>B</option><option>C</option></select></div>
              <div><label className="text-sm">Início</label><input type="time" className="w-full px-3 py-2 border rounded-md" value={form.start} onChange={e=>setForm({...form, start:e.target.value})} /></div>
              <div><label className="text-sm">Fim</label><input type="time" className="w-full px-3 py-2 border rounded-md" value={form.end} onChange={e=>setForm({...form, end:e.target.value})} /></div>
              <div><label className="text-sm">Etapa</label><select className="w-full px-3 py-2 border rounded-md" value={form.stage} onChange={e=>setForm({...form, stage:e.target.value})}><option>Britagem</option><option>Moagem</option></select></div>
              <div>
                <label className="text-sm">Equipamento</label>
                <div className="flex gap-2">
                  <input
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="Ex.: BT-01 / MM-01"
                    value={form.equipment}
                    onChange={e=>setForm({...form, equipment:e.target.value})}
                  />
                  <button
                    type="button"
                    onClick={openQR}
                    className="px-3 py-2 border rounded-md hover:bg-slate-50"
                    title="Ler código QR com a câmera"
                  >
                    <QrCode className="h-4 w-4"/>
                  </button>
                </div>
              </div>
              <div><label className="text-sm">Toneladas (t)</label><input type="number" step="0.01" inputMode="decimal" className="w-full px-3 py-2 border rounded-md" value={form.tonnage} onChange={e=>setForm({...form, tonnage:e.target.value})} required /></div>
              <div><label className="text-sm">Umidade (%)</label><input type="number" step="0.1" inputMode="decimal" className="w-full px-3 py-2 border rounded-md" value={form.moisture} onChange={e=>setForm({...form, moisture:e.target.value})} /></div>
              <div><label className="text-sm">Paradas (min)</label><input type="number" step="1" inputMode="numeric" className="w-full px-3 py-2 border rounded-md" value={form.downtime_min} onChange={e=>setForm({...form, downtime_min:e.target.value})} /></div>
              <div><label className="text-sm">Causa</label><input className="w-full px-3 py-2 border rounded-md" value={form.downtime_cause} onChange={e=>setForm({...form, downtime_cause:e.target.value})} /></div>
              <div><label className="text-sm">Meta t/h</label><input type="number" step="0.01" inputMode="decimal" className="w-full px-3 py-2 border rounded-md" value={form.tph_target} onChange={e=>setForm({...form, tph_target:e.target.value})} /></div>
              <div><label className="text-sm">Teor (g/t)</label><input type="number" step="0.01" inputMode="decimal" className="w-full px-3 py-2 border rounded-md" value={form.grade} onChange={e=>setForm({...form, grade:e.target.value})} /></div>
              <div className="col-span-2"><label className="text-sm">Observações</label><textarea rows="3" className="w-full px-3 py-2 border rounded-md" value={form.notes} onChange={e=>setForm({...form, notes:e.target.value})}></textarea></div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="text-sm text-slate-500 flex items-center gap-2"><ClockIcon/>{
                (()=>{ const h = parseTimeToHours(form.start, form.end); const dt = form.downtime_min? Number(form.downtime_min)/60 : 0; const oh = Math.max(0, h - dt); const tph = Number(form.tonnage||0) && h ? (Number(form.tonnage)/h) : 0; const tphOp = Number(form.tonnage||0) && oh ? (Number(form.tonnage)/oh) : 0; return <span>{h} h • {oh.toFixed(2)} h op • {tph? tph.toFixed(2):'0.00'} t/h • {tphOp? tphOp.toFixed(2):'0.00'} t/h op</span> })()
              }</div>
              <div className="flex gap-2">
                <button type="button" className="px-3 py-2 border rounded-md text-sm hover:bg-slate-50" onClick={resetForm}><RefreshCw className="inline mr-2 h-4 w-4"/>Limpar</button>
                <button type="submit" className="px-3 py-2 rounded-md text-white bg-slate-900 hover:bg-slate-800"><Save className="inline mr-2 h-4 w-4"/>{editingId ? 'Salvar' : 'Adicionar'}</button>
              </div>
            </div>
          </form>
        </div>

        {/* KPIs + GRÁFICOS + LISTA */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KPI icon={<BarChart3 className="h-5 w-5"/>} title="Total (filtro)" value={`${formatNumber(kpis.total)} t`} />
            <KPI icon={<Hammer className="h-5 w-5"/>} title="Britagem" value={`${formatNumber(kpis.totalBrit)} t`} />
            <KPI icon={<Hammer className="h-5 w-5"/>} title="Moagem" value={`${formatNumber(kpis.totalMoag)} t`} />
            <KPI icon={<CalendarRange className="h-5 w-5"/>} title="Hoje" value={`${formatNumber(kpis.todayT)} t`} />
            <KPI icon={<CalendarRange className="h-5 w-5"/>} title="Mês" value={`${formatNumber(kpis.monthT)} t`} />
          </div>

          {/* Produção diária – colunas (Moagem x Britagem) */}
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><BarChart3 className="h-5 w-5"/> Produção diária – Moagem × Britagem</div>
            <div className="h-72 px-2 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={dailyStageBars} margin={{ left: 4, right: 16, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" /><YAxis /><Tooltip /><Legend />
                  <Bar dataKey="Britagem" stackId="a" fill="#60a5fa" />
                  <Bar dataKey="Moagem" stackId="a" fill="#f59e0b" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* t/h operacional diário – linhas */}
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><BarChart3 className="h-5 w-5"/> t/h operacional (diário)</div>
            <div className="h-72 px-2 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={tphOperationalSeries} margin={{ left: 4, right: 16, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" /><YAxis /><Tooltip /><Legend />
                  <Line type="monotone" dataKey="t/h Britagem" stroke="#3b82f6" dot={false}/>
                  <Line type="monotone" dataKey="t/h Moagem" stroke="#10b981" dot={false}/>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Moagem – Diurno x Noturno */}
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><BarChart3 className="h-5 w-5"/> Moagem – Diurno × Noturno</div>
            <div className="h-72 px-2 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={moagemShiftBars} margin={{ left: 4, right: 16, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" /><YAxis /><Tooltip /><Legend />
                  <Bar dataKey="Diurno" fill="#fbbf24" />
                  <Bar dataKey="Noturno" fill="#fb7185" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Moagem por equipamento – empilhado */}
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><BarChart3 className="h-5 w-5"/> Moagem por equipamento (diário)</div>
            <div className="h-72 px-2 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={moagemStack} margin={{ left: 4, right: 16, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" /><YAxis /><Tooltip /><Legend />
                  {moagemEquipList.map((eq, i)=>(
                    <Bar key={eq} dataKey={eq} stackId="moag" fill={colorForEquipment(eq, i)} />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Britagem por equipamento – empilhado */}
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><BarChart3 className="h-5 w-5"/> Britagem por equipamento (diário)</div>
            <div className="h-72 px-2 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={britagemStack} margin={{ left: 4, right: 16, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" /><YAxis /><Tooltip /><Legend />
                  {britagemEquipList.map((eq, i)=>(
                    <Bar key={eq} dataKey={eq} stackId="brit" fill={colorForEquipment(eq, i)} />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Filtros + Lista */}
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><Filter className="h-5 w-5"/> Filtros & Lançamentos</div>
            <div className="px-4 pb-3 grid md:grid-cols-6 gap-3">
              <div><label className="text-sm">De</label><input type="date" className="w-full px-3 py-2 border rounded-md" value={filters.from} onChange={e=>setFilters({...filters, from:e.target.value})} /></div>
              <div><label className="text-sm">Até</label><input type="date" className="w-full px-3 py-2 border rounded-md" value={filters.to} onChange={e=>setFilters({...filters, to:e.target.value})} /></div>
              <div><label className="text-sm">Etapa</label><select className="w-full px-3 py-2 border rounded-md" value={filters.stage} onChange={e=>setFilters({...filters, stage:e.target.value})}><option>Todos</option><option>Britagem</option><option>Moagem</option></select></div>
              <div className="md:col-span-3"><label className="text-sm">Busca</label><div className="flex items-center gap-2"><Search className="h-4 w-4 text-slate-400"/><input className="w-full px-3 py-2 border rounded-md" placeholder="Operador, equipamento, notas..." value={filters.query} onChange={e=>setFilters({...filters, query:e.target.value})} /></div></div>
            </div>

            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500">
                  <tr className="border-b">
                    <th className="py-2 pr-3">Data</th>
                    <th className="py-2 pr-3">Etapa</th>
                    <th className="py-2 pr-3">Turno</th>
                    <th className="py-2 pr-3">Equipamento</th>
                    <th className="py-2 pr-3 text-right">t</th>
                    <th className="py-2 pr-3 text-right">h</th>
                    <th className="py-2 pr-3 text-right">Par(min)</th>
                    <th className="py-2 pr-3">Causa</th>
                    <th className="py-2 pr-3 text-right">h op</th>
                    <th className="py-2 pr-3 text-right">t/h</th>
                    <th className="py-2 pr-3 text-right">t/h op</th>
                    <th className="py-2 pr-3 text-right">Meta</th>
                    <th className="py-2 pr-3 text-right">Δ vs meta</th>
                    <th className="py-2 pr-3 text-right">Teor</th>
                    <th className="py-2 pr-3">Operador</th>
                    <th className="py-2 pr-3">Obs</th>
                    <th className="py-2 pr-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan="17" className="py-8 text-center text-slate-400">Sem lançamentos para os filtros aplicados.</td></tr>
                  )}
                  {filtered.map(e => {
                    const h = e.hours ?? parseTimeToHours(e.start, e.end)
                    const opH = e.op_hours ?? Math.max(0, h - ((e.downtime_min||0)/60))
                    const tph = e.tph ?? (h>0 ? +( (e.tonnage||0) / h ).toFixed(2) : undefined)
                    const tphOp = e.tph_operational ?? (opH>0 ? +( (e.tonnage||0) / opH ).toFixed(2) : undefined)
                    const delta = e.tph_delta ?? ((e.tph_target && tphOp!=null) ? +(tphOp - e.tph_target).toFixed(2) : undefined)
                    const deltaClass = delta==null ? '' : delta>=0 ? 'text-emerald-600' : 'text-rose-600'
                    return (
                      <tr key={e.id} className="border-b hover:bg-slate-50">
                        <td className="py-2 pr-3 whitespace-nowrap">{e.date}</td>
                        <td className="py-2 pr-3">{e.stage}</td>
                        <td className="py-2 pr-3">{e.shift || '—'}</td>
                        <td className="py-2 pr-3">{e.equipment || '—'}</td>
                        <td className="py-2 pr-3 text-right">{formatNumber(e.tonnage)}</td>
                        <td className="py-2 pr-3 text-right">{h ? formatNumber(h) : '—'}</td>
                        <td className="py-2 pr-3 text-right">{e.downtime_min!=null ? formatNumber(e.downtime_min,0) : '—'}</td>
                        <td className="py-2 pr-3">{e.downtime_cause || '—'}</td>
                        <td className="py-2 pr-3 text-right">{opH ? formatNumber(opH) : '—'}</td>
                        <td className="py-2 pr-3 text-right">{tph!=null ? formatNumber(tph) : '—'}</td>
                        <td className="py-2 pr-3 text-right">{tphOp!=null ? formatNumber(tphOp) : '—'}</td>
                        <td className="py-2 pr-3 text-right">{e.tph_target!=null ? formatNumber(e.tph_target) : '—'}</td>
                        <td className={`py-2 pr-3 text-right ${deltaClass}`}>{delta!=null ? formatNumber(delta) : '—'}</td>
                        <td className="py-2 pr-3 text-right">{e.grade!=null ? formatNumber(e.grade) : '—'}</td>
                        <td className="py-2 pr-3">{e.operator || '—'}</td>
                        <td className="py-2 pr-3 max-w-[28ch] truncate" title={e.notes}>{e.notes || '—'}</td>
                        <td className="py-2 pr-0 text-right">
                          <div className="flex gap-2 justify-end">
                            <button className="px-2 py-1 border rounded hover:bg-slate-50" onClick={()=>handleEdit(e.id)} title="Editar"><Edit className="h-4 w-4"/></button>
                            <button className="px-2 py-1 border rounded hover:bg-slate-50 text-red-600" onClick={()=>handleDelete(e.id)} title="Excluir"><Trash2 className="h-4 w-4"/></button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Relatórios (PDF) */}
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><FileText className="h-5 w-5"/> Relatórios PDF</div>
            <div className="px-4 pb-4 grid md:grid-cols-4 gap-3">
              <div className="col-span-2">
                <label className="text-sm">Relatório Diário – Data</label>
                <input type="date" className="w-full px-3 py-2 border rounded-md" value={reportDate} onChange={(e)=>setReportDate(e.target.value)} />
              </div>
              <div className="col-span-1">
                <label className="text-sm">Relatório Mensal – Mês</label>
                <input type="month" className="w-full px-3 py-2 border rounded-md" value={reportMonth} onChange={(e)=>setReportMonth(e.target.value)} />
              </div>
              <div className="col-span-1 flex items-end gap-2 flex-wrap">
                <button className="px-3 py-2 rounded-md text-white bg-slate-900 hover:bg-slate-800" onClick={exportDailyPDF}>PDF Diário</button>
                <button className="px-3 py-2 border rounded-md hover:bg-slate-50" onClick={sendDailyWhatsApp} title="Compartilhar via WhatsApp"><Send className="inline h-4 w-4 mr-1"/>WA</button>
                <button className="px-3 py-2 border rounded-md hover:bg-slate-50" onClick={sendDailyEmail} title="Enviar por e-mail"><Share2 className="inline h-4 w-4 mr-1"/>E-mail</button>
                <button className="px-3 py-2 rounded-md text-white bg-slate-900 hover:bg-slate-800" onClick={exportMonthlyPDF}>PDF Mensal</button>
                <button className="px-3 py-2 border rounded-md hover:bg-slate-50" onClick={sendMonthlyWhatsApp} title="Compartilhar via WhatsApp"><Send className="inline h-4 w-4 mr-1"/>WA</button>
                <button className="px-3 py-2 border rounded-md hover:bg-slate-50" onClick={sendMonthlyEmail} title="Enviar por e-mail"><Share2 className="inline h-4 w-4 mr-1"/>E-mail</button>
              </div>
            </div>
          </div>

        </div>
      </main>

      {/* Modal QR */}
      {qrOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg p-4 w-full max-w-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Ler QR – Equipamento</div>
              <button onClick={closeQR} className="px-2 py-1 border rounded hover:bg-slate-50">Fechar</button>
            </div>
            <div id="qr-reader" className="w-full h-[320px] bg-black rounded-md" />
            <p className="text-xs text-slate-500 mt-2">
              Dica: mire o QR da etiqueta do equipamento. Requer permissão da câmera (HTTPS).
            </p>
          </div>
        </div>
      )}

      <footer className="mx-auto max-w-7xl px-4 pb-8 pt-2 text-xs text-slate-500 space-y-1">
        <div><b>Dica:</b> defina as variáveis do Supabase em <code>.env</code> antes de usar a nuvem. O app funciona offline e sincroniza quando você clicar em <b>Sincronizar</b>.</div>
      </footer>
    </div>
  )
}