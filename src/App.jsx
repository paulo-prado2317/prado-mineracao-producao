import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import dayjs from 'dayjs'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import {
  BarChart3, CalendarRange, Download, Edit, Factory, Filter, Hammer, LogIn, LogOut,
  Mail, Plus, RefreshCw, Save, Search, Trash2, Upload, Cloud, Database, FileText,
  QrCode, Share2, Send, Settings, Wrench, PlusCircle, MinusCircle, Target, Star
} from 'lucide-react'
import {
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  Bar, ComposedChart, Line
} from 'recharts'
import KPI from '@/components/KPI'
import ClockIcon from '@/components/ClockIcon'
import Message from '@/components/Message'

// ------------------------------
// Constantes, Storage, Utils
// ------------------------------
const STORAGE_KEY = 'prado_mineracao_producao_v3'
const STORAGE_PENDING = 'prado_mineracao_pending_queue_v3'
const STORAGE_EQUIP = 'prado_mineracao_equip_v1'
const STORAGE_TARGETS = 'prado_mineracao_targets_v1'
const STORAGE_GOLD = 'prado_mineracao_gold_v1'

function uid(){ return Math.random().toString(36).slice(2) + Date.now().toString(36) }

function parseTimeToHours(start, end){
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins < 0) mins += 24 * 60
  return +(mins / 60).toFixed(2)
}
function diffMinutes(start, end){
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins < 0) mins += 24 * 60
  return mins
}
function cleanText(s){
  return String(s ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
function formatNumber(n, frac=2){
  if (n === undefined || n === null || isNaN(n)) return '0'
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: frac }).format(Number(n))
}

// Cores fixas para equipamentos + fallback
const EQUIP_COLORS = { 'MM-01': '#facc15', 'MM-02': '#f97316', 'BT-01': '#22c55e' }
const PALETTE = ['#60a5fa','#a78bfa','#34d399','#f472b6','#f59e0b','#10b981','#ef4444','#14b8a6','#8b5cf6','#e11d48']
function colorForEquipment(name, idx){
  const key = (name || '').toUpperCase()
  if (EQUIP_COLORS[key]) return EQUIP_COLORS[key]
  return PALETTE[idx % PALETTE.length]
}

// ------------------------------
// Supabase (opcional)
// ------------------------------
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
const supabase = (SUPABASE_URL && SUPABASE_ANON) ? createClient(SUPABASE_URL, SUPABASE_ANON) : null

export default function App(){
  // Sessão & mensagens
  const [session, setSession] = useState(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [msg, setMsg] = useState('')
  const emailRef = useRef(null)

  // Dados principais
  const today = dayjs().format('YYYY-MM-DD')
  const [entries, setEntries] = useState([])

  // Formulário de lançamento
  const [form, setForm] = useState({
    date: today, start: '07:00', end: '19:00', shift: 'Diurno',
    stage: 'Britagem', equipment: '', tonnage: '', moisture: '',
    operator: '', notes: '',
    stops: [{ id: uid(), from: '', to: '', cause: '' }], // paradas
    tph_target: '', grade: '',
  })
  const [allowEditTarget, setAllowEditTarget] = useState(false)

  // Filtros (período livre)
  const [filters, setFilters] = useState({ from: today, to: today, stage: 'Todos', query: '' })
  const [quickMonth, setQuickMonth] = useState(dayjs().format('YYYY-MM'))
  const [reportDate, setReportDate] = useState(today)
  const [reportMonth, setReportMonth] = useState(dayjs().format('YYYY-MM'))

  // Equipamentos
  const [equipments, setEquipments] = useState([]) // {id, code, stage, active}
  const [equipModal, setEquipModal] = useState(false)
  const [newEquip, setNewEquip] = useState({ code: '', stage: 'Britagem', active: true })

  // Metas fixas por etapa
  const [targets, setTargets] = useState({ Britagem: 0, Moagem: 0 })

  // Ouro (mensal)
  const [goldRecords, setGoldRecords] = useState([]) // {id, period:'YYYY-MM', kg:number}
  const [goldMonth, setGoldMonth] = useState(dayjs().format('YYYY-MM'))
  const [goldKg, setGoldKg] = useState('')

  // QR
  const [qrOpen, setQrOpen] = useState(false)
  const qrInstanceRef = useRef(null)

  // ---------- Carregamento inicial ----------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setEntries(JSON.parse(raw))
      const eq = localStorage.getItem(STORAGE_EQUIP)
      if (eq) setEquipments(JSON.parse(eq))
      const tg = localStorage.getItem(STORAGE_TARGETS)
      if (tg) setTargets(JSON.parse(tg))
      const gr = localStorage.getItem(STORAGE_GOLD)
      if (gr) setGoldRecords(JSON.parse(gr))
    } catch (e) {}
  }, [])
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)) }, [entries])
  useEffect(() => { localStorage.setItem(STORAGE_EQUIP, JSON.stringify(equipments)) }, [equipments])
  useEffect(() => { localStorage.setItem(STORAGE_TARGETS, JSON.stringify(targets)) }, [targets])
  useEffect(() => { localStorage.setItem(STORAGE_GOLD, JSON.stringify(goldRecords)) }, [goldRecords])

  // Seed equipamentos padrão
  useEffect(() => {
    if (equipments.length === 0){
      setEquipments([
        { id: uid(), code: 'BT-01', stage: 'Britagem', active: true },
        { id: uid(), code: 'MM-01', stage: 'Moagem', active: true },
        { id: uid(), code: 'MM-02', stage: 'Moagem', active: true },
      ])
    }
  }, [])

  // Supabase auth (opcional)
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => { setSession(sess) })
    return () => { sub?.subscription.unsubscribe() }
  }, [])

  // ---------- Helpers Cloud ----------
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
        if (op.type === 'upsert') {
          await supabase.from('production_entries').upsert(op.payload)
        } else if (op.type === 'delete') {
          await supabase.from('production_entries').delete().eq('id', op.id)
        }
      }
      localStorage.removeItem(STORAGE_PENDING)
      setMsg('Pendências sincronizadas.')
    } finally { setIsSyncing(false) }
  }

  // ---------- Lançamento ----------
  const totalStopsMin = useMemo(() => {
    return (form.stops || []).reduce((acc, s) => acc + (diffMinutes(s.from, s.to) || 0), 0)
  }, [form.stops])

  useEffect(() => {
    const t = Number(targets[form.stage] || 0)
    setForm(prev => ({ ...prev, tph_target: t ? String(t) : '' }))
  }, [form.stage, targets])

  function addStop(){
    setForm(prev => ({ ...prev, stops: [...prev.stops, { id: uid(), from: '', to: '', cause: '' }] }))
  }
  function removeStop(id){
    setForm(prev => ({ ...prev, stops: prev.stops.filter(s => s.id !== id) }))
  }
  function updateStop(id, patch){
    setForm(prev => ({ ...prev, stops: prev.stops.map(s => s.id === id ? { ...s, ...patch } : s) }))
  }

  function resetForm(){
    setForm({
      date: dayjs().format('YYYY-MM-DD'), start: '07:00', end: '19:00', shift: 'Diurno',
      stage: 'Britagem', equipment: '', tonnage: '', moisture: '', operator: '', notes: '',
      stops: [{ id: uid(), from: '', to: '', cause: '' }],
      tph_target: targets['Britagem'] ? String(targets['Britagem']) : '', grade: '',
    })
    setAllowEditTarget(false)
  }

  async function handleSubmit(e){
    e.preventDefault()
    const hours = parseTimeToHours(form.start, form.end)
    const downtimeMin = totalStopsMin
    const opHours = Math.max(0, hours - (downtimeMin/60))
    const tonnage = Number(form.tonnage || 0)
    const tph = hours > 0 ? +(tonnage / hours).toFixed(2) : undefined
    const tphOperational = opHours > 0 ? +(tonnage / opHours).toFixed(2) : undefined

    const payload = {
      id: uid(),
      date: form.date, start: form.start, end: form.end, shift: form.shift, stage: form.stage,
      equipment: form.equipment, tonnage,
      moisture: form.moisture !== '' ? Number(form.moisture) : undefined,
      operator: cleanText(form.operator), notes: cleanText(form.notes),
      hours, tph,
      downtime_min: downtimeMin, downtime_cause: cleanText(form.stops?.map(s=>s.cause).filter(Boolean).join('; ')),
      op_hours: opHours, tph_operational: tphOperational,
      tph_target: form.tph_target !== '' ? Number(form.tph_target) : undefined,
      tph_delta: (form.tph_target && tphOperational) ? +(tphOperational - Number(form.tph_target)).toFixed(2) : undefined,
      grade: form.grade !== '' ? Number(form.grade) : undefined,
      stops_json: JSON.stringify(form.stops || []),
      createdAt: new Date().toISOString(),
    }

    setEntries(prev => [...prev, payload])

    try {
      if (supabase && session?.user) {
        await supabase.from('production_entries').upsert(payload)
      } else {
        queuePending({ type: 'upsert', payload })
      }
      setMsg('Lançamento adicionado.')
    } catch {
      queuePending({ type: 'upsert', payload })
      setMsg('Sem conexão. Salvo localmente para sincronizar depois.')
    }

    resetForm()
  }

  async function handleDelete(id){
    setEntries(prev => prev.filter(x => x.id !== id))
    try {
      if (supabase && session?.user) await supabase.from('production_entries').delete().eq('id', id)
      else queuePending({ type: 'delete', id })
      setMsg('Lançamento removido.')
    } catch {
      queuePending({ type: 'delete', id })
      setMsg('Sem conexão. Remoção pendente para sincronizar.')
    }
  }

  // ---------- Equipamentos ----------
  const equipByStage = useMemo(() => ({
    Britagem: equipments.filter(e => e.stage === 'Britagem' && e.active),
    Moagem: equipments.filter(e => e.stage === 'Moagem' && e.active),
  }), [equipments])

  function saveNewEquip(){
    if (!newEquip.code.trim()) return
    setEquipments(prev => [...prev, { id: uid(), code: newEquip.code.trim().toUpperCase(), stage: newEquip.stage, active: !!newEquip.active }])
    setNewEquip({ code: '', stage: 'Britagem', active: true })
    setEquipModal(false)
  }

  // ---------- Filtros & Agregações ----------
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

  // Somatórios por etapa (não somar juntas)
  const sums = useMemo(() => {
    const sum = (arr, fn) => arr.reduce((acc, x) => acc + (fn(x) || 0), 0)
    const britF = sum(filtered.filter(x => x.stage === 'Britagem'), x => x.tonnage)
    const moagF = sum(filtered.filter(x => x.stage === 'Moagem'), x => x.tonnage)
    const todayStr = dayjs().format('YYYY-MM-DD')
    const britHoje = sum(entries.filter(x => x.date === todayStr && x.stage === 'Britagem'), x => x.tonnage)
    const moagHoje = sum(entries.filter(x => x.date === todayStr && x.stage === 'Moagem'), x => x.tonnage)
    const monthStr = dayjs().format('YYYY-MM')
    const moagMes = sum(entries.filter(x => String(x.date).startsWith(monthStr) && x.stage === 'Moagem'), x => x.tonnage)
    return { britF, moagF, britHoje, moagHoje, moagMes }
  }, [filtered, entries])

  // Charts (usam o período filtrado)
  const dailyStageBars = useMemo(() => {
    const map = new Map()
    for (const e of filtered){
      if (!map.has(e.date)) map.set(e.date, { date: e.date, Britagem: 0, Moagem: 0 })
      map.get(e.date)[e.stage] += e.tonnage || 0
    }
    return Array.from(map.values()).sort((a,b) => a.date < b.date ? -1 : 1)
  }, [filtered])

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

  function stackedByEquipment(stageName){
    const map = new Map()
    const eqIndex = new Map()
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

  // ---------- PDF helpers ----------
  async function exportHTMLToPDFPaginated(html, filename){
    const wrapper = document.createElement('div')
    wrapper.innerHTML = html
    document.body.appendChild(wrapper)

    const canvas = await html2canvas(wrapper, { scale: 2, backgroundColor: '#ffffff' })
    const img = canvas.toDataURL('image/png')

    const pdf = new jsPDF('p','mm','a4')
    const pdfW = pdf.internal.pageSize.getWidth()
    const pdfH = pdf.internal.pageSize.getHeight()

    const imgH = (canvas.height * pdfW) / canvas.width
    let heightLeft = imgH
    let position = 0

    pdf.addImage(img, 'PNG', 0, position, pdfW, imgH)
    heightLeft -= pdfH

    while (heightLeft > 0) {
      position = -(imgH - heightLeft)
      pdf.addPage()
      pdf.addImage(img, 'PNG', 0, position, pdfW, imgH)
      heightLeft -= pdfH
    }

    pdf.save(filename)
    document.body.removeChild(wrapper)
  }

  function renderDailyHTML(dateStr){
    const data = entries.filter(e => e.date === dateStr)
    const sum = (arr, fn) => arr.reduce((acc, x) => acc + (fn(x) || 0), 0)
    const brit = sum(data.filter(x=>x.stage==='Britagem'), x=>x.tonnage)
    const moag = sum(data.filter(x=>x.stage==='Moagem'), x=>x.tonnage)

    const byEquip = {}
    for(const e of data){
      const k = `${e.stage} - ${cleanText(e.equipment||'N/D').toUpperCase()}`
      byEquip[k] = (byEquip[k]||0) + (e.tonnage||0)
    }

    return `
      <div style="font-family: Arial, sans-serif; padding: 12px; width: 820px;">
        <h2>Relatório Diário – ${dayjs(dateStr).format('DD/MM/YYYY')}</h2>
        <div><b>Prado Mineração</b></div>
        <hr/>
        <p><b>Britagem (t):</b> ${formatNumber(brit)} | <b>Moagem (t):</b> ${formatNumber(moag)}</p>
        <h3 style="margin-top:12px;">Por Equipamento</h3>
        <table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse; width:100%;">
          <tr><th>Etapa • Equipamento</th><th style="text-align:right">t</th></tr>
          ${Object.entries(byEquip).map(([k,v])=>`<tr><td>${k}</td><td style="text-align:right">${formatNumber(v)}</td></tr>`).join('')}
        </table>
      </div>
    `
  }

  function renderMonthlyHTML(ym){
    const data = entries.filter(e => String(e.date).startsWith(ym))
    const sum = (arr, fn) => arr.reduce((acc, x) => acc + (fn(x) || 0), 0)
    const brit = sum(data.filter(x=>x.stage==='Britagem'), x=>x.tonnage)
    const moag = sum(data.filter(x=>x.stage==='Moagem'), x=>x.tonnage)
    const byDay = {}
    for(const e of data){
      if(!byDay[e.date]) byDay[e.date] = { Britagem:0, Moagem:0 }
      byDay[e.date][e.stage] += e.tonnage||0
    }
    return `
      <div style="font-family: Arial, sans-serif; padding: 12px; width: 840px;">
        <h2>Relatório Mensal – ${dayjs(ym+'-01').format('MM/YYYY')}</h2>
        <div><b>Prado Mineração</b></div>
        <hr/>
        <p><b>Britagem (t):</b> ${formatNumber(brit)} | <b>Moagem (t):</b> ${formatNumber(moag)}</p>
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

  function renderPeriodHTML(from, to){
    const data = entries.filter(e => (!from || !dayjs(e.date).isBefore(dayjs(from))) && (!to || !dayjs(e.date).isAfter(dayjs(to))))
    const sum = (arr, fn) => arr.reduce((acc, x) => acc + (fn(x) || 0), 0)
    const brit = sum(data.filter(x=>x.stage==='Britagem'), x=>x.tonnage)
    const moag = sum(data.filter(x=>x.stage==='Moagem'), x=>x.tonnage)
    const byDay = {}
    for(const e of data){
      if(!byDay[e.date]) byDay[e.date] = { Britagem:0, Moagem:0 }
      byDay[e.date][e.stage] += e.tonnage||0
    }
    return `
      <div style="font-family: Arial, sans-serif; padding: 12px; width: 840px;">
        <h2>Relatório do Período – ${dayjs(from).format('DD/MM/YYYY')} a ${dayjs(to).format('DD/MM/YYYY')}</h2>
        <div><b>Prado Mineração</b></div>
        <hr/>
        <p><b>Britagem (t):</b> ${formatNumber(brit)} | <b>Moagem (t):</b> ${formatNumber(moag)}</p>
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

  async function exportDailyPDF(){ await exportHTMLToPDFPaginated(renderDailyHTML(reportDate), `relatorio_diario_${reportDate}.pdf`) }
  async function exportMonthlyPDF(){ await exportHTMLToPDFPaginated(renderMonthlyHTML(reportMonth), `relatorio_mensal_${reportMonth}.pdf`) }
  async function exportPeriodPDF(){ await exportHTMLToPDFPaginated(renderPeriodHTML(filters.from, filters.to), `relatorio_periodo_${filters.from}_a_${filters.to}.pdf`) }

  // Compartilhar (WhatsApp / Email)
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
    const canvas = await html2canvas(wrapper, { scale: 2, backgroundColor: '#ffffff' })
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
  async function sendPeriodWhatsApp(){
    const blob = await htmlToPDFBlob(renderPeriodHTML(filters.from, filters.to))
    await shareFileOrDownload({
      blob, filename: `relatorio_periodo_${filters.from}_a_${filters.to}.pdf`,
      title: `Relatório ${dayjs(filters.from).format('DD/MM')} a ${dayjs(filters.to).format('DD/MM')}`,
      text: `Relatório ${dayjs(filters.from).format('DD/MM')} a ${dayjs(filters.to).format('DD/MM')}`,
      fallbackWhatsApp: true
    })
  }
  async function sendPeriodEmail(){
    const blob = await htmlToPDFBlob(renderPeriodHTML(filters.from, filters.to))
    await shareFileOrDownload({
      blob, filename: `relatorio_periodo_${filters.from}_a_${filters.to}.pdf`,
      title: `Relatório ${dayjs(filters.from).format('DD/MM')} a ${dayjs(filters.to).format('DD/MM')}`,
      text: `Segue relatório do período ${dayjs(filters.from).format('DD/MM')} a ${dayjs(filters.to).format('DD/MM')}.`
    })
  }

  // ---------- QR ----------
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
          const code = decodedText.trim().toUpperCase()
          if (!equipments.some(e => e.code === code)){
            if (confirm(`Adicionar equipamento ${code} para ${form.stage}?`)){
              setEquipments(prev => [...prev, { id: uid(), code, stage: form.stage, active: true }])
            }
          }
          setForm(prev => ({ ...prev, equipment: code }))
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

  // ---------- Exportações ----------
  function exportCSV(){
    const header = ['id','data','inicio','fim','turno','etapa','equipamento','toneladas','umidade_%','operador','observacoes','horas','t/h','paradas_min','causas','h_oper','t/h_oper','t/h_meta','Δ_vs_meta','teor_g_t','paradas_json','criado_em']
    const rows = entries.map(e => [
      e.id, e.date, e.start || '', e.end || '', e.shift || '', e.stage, e.equipment || '',
      e.tonnage ?? '', e.moisture ?? '', e.operator || '', (e.notes || '').replaceAll('\n',' '),
      e.hours ?? '', e.tph ?? '', e.downtime_min ?? '', e.downtime_cause || '',
      e.op_hours ?? '', e.tph_operational ?? '', e.tph_target ?? '', e.tph_delta ?? '',
      e.grade ?? '', e.stops_json || '[]', e.createdAt || ''
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

  // ---------- Resumo do Ouro ----------
  const goldCalcPeriod = useMemo(() => {
    const tons = entries.filter(e => String(e.date).startsWith(goldMonth) && e.stage === 'Moagem').reduce((a,x)=>a+(x.tonnage||0),0)
    const kg = Number(goldKg || 0)
    const gt = tons > 0 ? (kg*1000)/tons : 0
    return { tons, kg, gt }
  }, [entries, goldMonth, goldKg])

  function saveGoldMonth(){
    if (!goldMonth) return
    const kg = Number(goldKg || 0)
    const existing = goldRecords.find(r => r.period === goldMonth)
    if (existing){
      setGoldRecords(prev => prev.map(r => r.period === goldMonth ? { ...r, kg } : r))
    } else {
      setGoldRecords(prev => [...prev, { id: uid(), period: goldMonth, kg }])
    }
    setMsg('Resumo do ouro salvo para o mês.')
  }

  // ---------- UI ----------
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Message text={msg} onClose={() => setMsg('')} />

      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-3">
          <div className="p-2 rounded-xl bg-slate-100"><Factory className="h-6 w-6" /></div>
          <div className="flex-1">
            <h1 className="text-xl md:text-2xl font-bold leading-tight">Mineração – Lançamentos & Dash</h1>
            <p className="text-sm text-slate-500">Britagem e Moagem separados · Período livre · PWA offline · QR · PDF · Ouro</p>
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
              <div><label className="text-sm">Etapa</label><select className="w-full px-3 py-2 border rounded-md" value={form.stage} onChange={e=>setForm({...form, stage:e.target.value, equipment: ''})}><option>Britagem</option><option>Moagem</option></select></div>
              <div>
                <label className="text-sm">Equipamento</label>
                <div className="flex gap-2">
                  <select className="w-full px-3 py-2 border rounded-md" value={form.equipment} onChange={e=>setForm({...form, equipment:e.target.value})}>
                    <option value="">Selecione...</option>
                    {(equipByStage[form.stage] || []).map(eq => <option key={eq.id} value={eq.code}>{eq.code}</option>)}
                  </select>
                  <button type="button" onClick={openQR} className="px-3 py-2 border rounded-md hover:bg-slate-50" title="Ler QR"><QrCode className="h-4 w-4"/></button>
                  <button type="button" onClick={()=>setEquipModal(true)} className="px-3 py-2 border rounded-md hover:bg-slate-50" title="Novo equipamento"><PlusCircle className="h-4 w-4"/></button>
                </div>
              </div>
              <div><label className="text-sm">Toneladas (t)</label><input type="number" step="0.01" inputMode="decimal" className="w-full px-3 py-2 border rounded-md" value={form.tonnage} onChange={e=>setForm({...form, tonnage:e.target.value})} required /></div>
              <div><label className="text-sm">Umidade (%)</label><input type="number" step="0.1" inputMode="decimal" className="w-full px-3 py-2 border rounded-md" value={form.moisture} onChange={e=>setForm({...form, moisture:e.target.value})} /></div>
              <div className="col-span-2">
                <label className="text-sm font-medium flex items-center gap-2"><MinusCircle className="h-4 w-4"/> Paradas (somatório automático)</label>
                {(form.stops || []).map(s => (
                  <div key={s.id} className="mt-2 grid grid-cols-8 gap-2 items-end">
                    <div className="col-span-2"><label className="text-xs text-slate-500">De</label><input type="time" className="w-full px-2 py-2 border rounded-md" value={s.from} onChange={e=>updateStop(s.id,{from:e.target.value})}/></div>
                    <div className="col-span-2"><label className="text-xs text-slate-500">Até</label><input type="time" className="w-full px-2 py-2 border rounded-md" value={s.to} onChange={e=>updateStop(s.id,{to:e.target.value})}/></div>
                    <div className="col-span-3"><label className="text-xs text-slate-500">Causa</label><input className="w-full px-2 py-2 border rounded-md" value={s.cause} onChange={e=>updateStop(s.id,{cause:e.target.value})}/></div>
                    <div className="col-span-1 text-right">
                      <button type="button" className="px-2 py-2 border rounded-md hover:bg-slate-50" onClick={()=>removeStop(s.id)}>Remover</button>
                    </div>
                  </div>
                ))}
                <div className="mt-2 flex items-center justify-between text-sm">
                  <button type="button" onClick={addStop} className="px-3 py-2 border rounded-md hover:bg-slate-50"><Plus className="inline h-4 w-4 mr-1"/>Adicionar parada</button>
                  <div className="text-slate-600">Total paradas: <b>{formatNumber(totalStopsMin,0)} min</b></div>
                </div>
              </div>
              <div className="col-span-2"><label className="text-sm">Observações</label><textarea rows="3" className="w-full px-3 py-2 border rounded-md" value={form.notes} onChange={e=>setForm({...form, notes:e.target.value})}></textarea></div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="text-sm text-slate-500 flex items-center gap-2">
                <ClockIcon/>
                {(() => {
                  const h = parseTimeToHours(form.start, form.end)
                  const dt = totalStopsMin/60
                  const oh = Math.max(0, h - dt)
                  const tph = Number(form.tonnage||0) && h ? (Number(form.tonnage)/h) : 0
                  const tphOp = Number(form.tonnage||0) && oh ? (Number(form.tonnage)/oh) : 0
                  return <span>{h} h • {oh.toFixed(2)} h op • {tph? tph.toFixed(2):'0.00'} t/h • {tphOp? tphOp.toFixed(2):'0.00'} t/h op</span>
                })()}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 mr-2">
                  <Target className="h-4 w-4 text-slate-500"/>
                  <span className="text-sm text-slate-600">Meta {form.stage}:</span>
                  <input className="w-24 px-2 py-1 border rounded-md text-right disabled:bg-slate-100" type="number" step="0.01" value={form.tph_target} onChange={e=>setForm({...form, tph_target:e.target.value})} disabled={!allowEditTarget} />
                  <button type="button" className="px-2 py-1 border rounded-md hover:bg-slate-50 text-xs" onClick={()=>setAllowEditTarget(v=>!v)}>{allowEditTarget ? 'Bloquear' : 'Editar'}</button>
                </div>
                <button type="button" className="px-3 py-2 border rounded-md text-sm hover:bg-slate-50" onClick={resetForm}><RefreshCw className="inline mr-2 h-4 w-4"/>Limpar</button>
                <button type="submit" className="px-3 py-2 rounded-md text-white bg-slate-900 hover:bg-slate-800"><Save className="inline mr-2 h-4 w-4"/>Adicionar</button>
              </div>
            </div>
          </form>
        </div>

        {/* Dash & Listas */}
        <div className="lg:col-span-2 space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KPI icon={<Hammer className="h-5 w-5"/>} title="Britagem (filtro)" value={`${formatNumber(sums.britF)} t`} />
            <KPI icon={<Hammer className="h-5 w-5"/>} title="Moagem (filtro)" value={`${formatNumber(sums.moagF)} t`} />
            <KPI icon={<CalendarRange className="h-5 w-5"/>} title="Hoje – Britagem" value={`${formatNumber(sums.britHoje)} t`} />
            <KPI icon={<CalendarRange className="h-5 w-5"/>} title="Hoje – Moagem" value={`${formatNumber(sums.moagHoje)} t`} />
            <KPI icon={<CalendarRange className="h-5 w-5"/>} title="Mês – Moagem" value={`${formatNumber(sums.moagMes)} t`} />
          </div>

          {/* Filtros período + atalhos */}
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><Filter className="h-5 w-5"/> Período do Dashboard</div>
            <div className="px-4 pb-3 grid md:grid-cols-7 gap-3">
              <div><label className="text-sm">De</label><input type="date" className="w-full px-3 py-2 border rounded-md" value={filters.from} onChange={e=>setFilters({...filters, from:e.target.value})} /></div>
              <div><label className="text-sm">Até</label><input type="date" className="w-full px-3 py-2 border rounded-md" value={filters.to} onChange={e=>setFilters({...filters, to:e.target.value})} /></div>
              <div><label className="text-sm">Etapa</label><select className="w-full px-3 py-2 border rounded-md" value={filters.stage} onChange={e=>setFilters({...filters, stage:e.target.value})}><option>Todos</option><option>Britagem</option><option>Moagem</option></select></div>
              <div className="md:col-span-2"><label className="text-sm">Busca</label><div className="flex items-center gap-2"><Search className="h-4 w-4 text-slate-400"/><input className="w-full px-3 py-2 border rounded-md" placeholder="Operador, equipamento, notas..." value={filters.query} onChange={e=>setFilters({...filters, query:e.target.value})} /></div></div>
              <div><label className="text-sm">Atalho (mês)</label><input type="month" className="w-full px-3 py-2 border rounded-md" value={quickMonth} onChange={e=>setQuickMonth(e.target.value)} /></div>
              <div className="flex items-end gap-2">
                <button className="px-2 py-2 border rounded-md hover:bg-slate-50 text-sm" onClick={()=>setFilters(f=>({...f, from: `${quickMonth}-01`, to: `${quickMonth}-15`}))}>01–15</button>
                <button className="px-2 py-2 border rounded-md hover:bg-slate-50 text-sm" onClick={()=>setFilters(f=>({...f, from: `${quickMonth}-16`, to: `${quickMonth}-31`}))}>16–31</button>
                <button className="px-2 py-2 border rounded-md hover:bg-slate-50 text-sm" onClick={()=>{ const m = dayjs().format('YYYY-MM'); setFilters(f=>({...f, from:`${m}-01`, to:`${m}-31`})) }}>Mês atual</button>
                <button className="px-2 py-2 border rounded-md hover:bg-slate-50 text-sm" onClick={()=>{ const d = dayjs().format('YYYY-MM-DD'); setFilters(f=>({...f, from:d, to:d})) }}>Hoje</button>
              </div>
            </div>
          </div>

          {/* Gráfico Produção diária – Moagem × Britagem */}
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><BarChart3 className="h-5 w-5"/> Produção diária – Moagem × Britagem (período aplicado)</div>
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
            <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><BarChart3 className="h-5 w-5"/> t/h operacional (período aplicado)</div>
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

          {/* Empilhados por equipamento */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-2xl border bg-white shadow-sm">
              <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><BarChart3 className="h-5 w-5"/> Moagem por equipamento</div>
              <div className="h-72 px-2 pb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={moagemStack} margin={{ left: 4, right: 16, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" /><YAxis /><Tooltip /><Legend />
                    {moagemEquipList.map((eq, i)=>(<Bar key={eq} dataKey={eq} stackId="moag" fill={colorForEquipment(eq, i)} />))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-2xl border bg-white shadow-sm">
              <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><BarChart3 className="h-5 w-5"/> Britagem por equipamento</div>
              <div className="h-72 px-2 pb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={britagemStack} margin={{ left: 4, right: 16, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" /><YAxis /><Tooltip /><Legend />
                    {britagemEquipList.map((eq, i)=>(<Bar key={eq} dataKey={eq} stackId="brit" fill={colorForEquipment(eq, i)} />))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Lista + PDF de período */}
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><Filter className="h-5 w-5"/> Lançamentos (período aplicado)</div>
            <div className="px-4 pb-3 flex items-center gap-2">
              <button className="px-3 py-2 rounded-md text-white bg-slate-900 hover:bg-slate-800" onClick={exportPeriodPDF}>PDF do Período</button>
              <button className="px-3 py-2 border rounded-md hover:bg-slate-50" onClick={sendPeriodWhatsApp}><Send className="inline h-4 w-4 mr-1"/>WA</button>
              <button className="px-3 py-2 border rounded-md hover:bg-slate-50" onClick={sendPeriodEmail}><Share2 className="inline h-4 w-4 mr-1"/>E-mail</button>
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
                    <th className="py-2 pr-3">Causas</th>
                    <th className="py-2 pr-3 text-right">h op</th>
                    <th className="py-2 pr-3 text-right">t/h</th>
                    <th className="py-2 pr-3 text-right">t/h op</th>
                    <th className="py-2 pr-3 text-right">Meta</th>
                    <th className="py-2 pr-3 text-right">Δ vs meta</th>
                    <th className="py-2 pr-3">Obs</th>
                    <th className="py-2 pr-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan="15" className="py-8 text-center text-slate-400">Sem lançamentos para os filtros aplicados.</td></tr>
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
                        <td className="py-2 pr-3 max-w-[28ch] truncate" title={e.notes}>{e.notes || '—'}</td>
                        <td className="py-2 pr-0 text-right">
                          <div className="flex gap-2 justify-end">
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

          {/* RESUMO DO OURO */}
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><Star className="h-5 w-5"/> Resumo do Ouro</div>
            <div className="px-4 pb-4 grid md:grid-cols-5 gap-3">
              <div><label className="text-sm">Mês</label><input type="month" className="w-full px-3 py-2 border rounded-md" value={goldMonth} onChange={e=>setGoldMonth(e.target.value)} /></div>
              <div><label className="text-sm">Ouro recuperado (kg)</label><input type="number" step="0.001" className="w-full px-3 py-2 border rounded-md" value={goldKg} onChange={e=>setGoldKg(e.target.value)} /></div>
              <div className="md:col-span-3 flex items-end gap-2">
                <div className="px-3 py-2 border rounded-md text-sm">Moagem do mês: <b>{formatNumber(goldCalcPeriod.tons)}</b> t</div>
                <div className="px-3 py-2 border rounded-md text-sm">Teor médio: <b>{formatNumber(goldCalcPeriod.gt)}</b> g/t</div>
                <button className="px-3 py-2 rounded-md text-white bg-slate-900 hover:bg-slate-800" onClick={saveGoldMonth}><Save className="inline h-4 w-4 mr-1"/>Salvar mês</button>
              </div>
            </div>
            {goldRecords.length>0 && (
              <div className="px-4 pb-4">
                <div className="text-sm font-medium mb-2">Histórico</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-slate-500"><tr className="border-b"><th className="py-2 pr-3">Mês</th><th className="py-2 pr-3 text-right">Ouro (kg)</th><th className="py-2 pr-3 text-right">Moagem (t)</th><th className="py-2 pr-3 text-right">g/t</th></tr></thead>
                    <tbody>
                      {goldRecords.sort((a,b)=>a.period<b.period?-1:1).map(r => {
                        const tons = entries.filter(e => String(e.date).startsWith(r.period) && e.stage === 'Moagem').reduce((a,x)=>a+(x.tonnage||0),0)
                        const gt = tons>0 ? (r.kg*1000)/tons : 0
                        return (<tr key={r.id} className="border-b">
                          <td className="py-2 pr-3 whitespace-nowrap">{dayjs(r.period+'-01').format('MM/YYYY')}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(r.kg,3)}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(tons)}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(gt)}</td>
                        </tr>)
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* CONFIGURAÇÕES: Equipamentos & Metas */}
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><Settings className="h-5 w-5"/> Configurações</div>
            <div className="px-4 pb-4 grid md:grid-cols-2 gap-6">
              <div>
                <div className="font-medium mb-2 flex items-center gap-2"><Wrench className="h-4 w-4"/> Equipamentos</div>
                <div className="space-y-2">
                  {equipments.map(eq => (
                    <div key={eq.id} className="flex items-center gap-2 border rounded-md px-2 py-1">
                      <span className="text-sm w-28">{eq.code}</span>
                      <span className="text-xs text-slate-500 w-24">{eq.stage}</span>
                      <label className="text-xs ml-auto flex items-center gap-1">
                        <input type="checkbox" checked={eq.active} onChange={e=>setEquipments(prev=>prev.map(x=>x.id===eq.id?{...x,active:e.target.checked}:x))}/>
                        ativo
                      </label>
                      <button className="px-2 py-1 border rounded-md hover:bg-slate-50 text-xs" onClick={()=>setEquipments(prev=>prev.filter(x=>x.id!==eq.id))}>Remover</button>
                    </div>
                  ))}
                  <button className="px-3 py-2 border rounded-md hover:bg-slate-50 text-sm" onClick={()=>setEquipModal(true)}><Plus className="inline h-4 w-4 mr-1"/>Novo equipamento</button>
                </div>
              </div>
              <div>
                <div className="font-medium mb-2 flex items-center gap-2"><Target className="h-4 w-4"/> Metas fixas (t/h)</div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-sm">Britagem</label><input type="number" step="0.01" className="w-full px-3 py-2 border rounded-md" value={targets.Britagem} onChange={e=>setTargets(t=>({...t, Britagem: Number(e.target.value||0)}))}/></div>
                  <div><label className="text-sm">Moagem</label><input type="number" step="0.01" className="w-full px-3 py-2 border rounded-md" value={targets.Moagem} onChange={e=>setTargets(t=>({...t, Moagem: Number(e.target.value||0)}))}/></div>
                </div>
                <p className="text-xs text-slate-500 mt-2">Essas metas preenchem automaticamente o campo do formulário (pode destravar e editar por lançamento).</p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Modal: Equipamento */}
      {equipModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg p-4 w-full max-w-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Novo Equipamento</div>
              <button onClick={()=>setEquipModal(false)} className="px-2 py-1 border rounded hover:bg-slate-50">Fechar</button>
            </div>
            <div className="space-y-2">
              <div><label className="text-sm">Código</label><input className="w-full px-3 py-2 border rounded-md" value={newEquip.code} onChange={e=>setNewEquip({...newEquip, code:e.target.value})} placeholder="Ex.: MM-03"/></div>
              <div><label className="text-sm">Etapa</label><select className="w-full px-3 py-2 border rounded-md" value={newEquip.stage} onChange={e=>setNewEquip({...newEquip, stage:e.target.value})}><option>Britagem</option><option>Moagem</option></select></div>
              <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={newEquip.active} onChange={e=>setNewEquip({...newEquip, active:e.target.checked})}/> Ativo</label>
              <div className="pt-2 flex justify-end"><button className="px-3 py-2 rounded-md text-white bg-slate-900 hover:bg-slate-800" onClick={saveNewEquip}><Save className="inline h-4 w-4 mr-1"/>Salvar</button></div>
            </div>
          </div>
        </div>
      )}

      {/* Modal QR */}
      {qrOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg p-4 w-full max-w-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Ler QR – Equipamento</div>
              <button onClick={closeQR} className="px-2 py-1 border rounded hover:bg-slate-50">Fechar</button>
            </div>
            <div id="qr-reader" className="w-full h-[320px] bg-black rounded-md" />
            <p className="text-xs text-slate-500 mt-2">Dica: mire o QR da etiqueta. Requer permissão da câmera (HTTPS).</p>
          </div>
        </div>
      )}

      <footer className="mx-auto max-w-7xl px-4 pb-8 pt-2 text-xs text-slate-500 space-y-1">
        <div><b>Período livre:</b> ajuste "De/Até" para ver os gráficos de 01–15, 16–31 etc. Gere o <b>PDF do Período</b> nos botões da lista.</div>
      </footer>
    </div>
  )
}
