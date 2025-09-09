import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import dayjs from 'dayjs'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import {
  BarChart3, CalendarRange, Download, Factory, Filter, Hammer, LogIn, LogOut,
  Mail, Plus, RefreshCw, Save, Search, Trash2, Upload, Cloud, Database, FileText,
  QrCode, Share2, Send, Settings, Wrench, PlusCircle, MinusCircle, Target, Star, Users, Shield
} from 'lucide-react'
import {
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  Bar, ComposedChart
} from 'recharts'

/* ---------- Utils ---------- */
function KPI({ icon, title, value }) {
  return (
    <div className="rounded-xl border bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}<span className="text-sm">{title}</span>
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  )
}
function ClockIcon(){ return <span className="inline-block">⏱️</span> }
function Message({ text, onClose, tone='ok' }) {
  if (!text) return null
  const color = tone === 'error' ? 'bg-rose-600' : 'bg-emerald-600'
  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50">
      <div className={`${color} text-white px-4 py-2 rounded-xl shadow`}>
        {text}
        <button className="ml-3 underline" onClick={onClose}>Fechar</button>
      </div>
    </div>
  )
}
const STORAGE_KEY = 'prado_mineracao_producao_v7'
const STORAGE_PENDING = 'prado_mineracao_pending_queue_v4'
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
const EQUIP_COLORS = { 'MM-01': '#facc15', 'MM-02': '#f97316', 'BT-01': '#22c55e' }
const PALETTE = ['#60a5fa','#a78bfa','#34d399','#f472b6','#f59e0b','#10b981','#ef4444','#14b8a6','#8b5cf6','#e11d48']
const colorForEquipment = (name, idx) => EQUIP_COLORS[(name||'').toUpperCase()] || PALETTE[idx % PALETTE.length]

/* ---------- Supabase ---------- */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
const supabase = (SUPABASE_URL && SUPABASE_ANON) ? createClient(SUPABASE_URL, SUPABASE_ANON) : null
const APP_NAME = 'Mineração CANGAS II'
const GROUP_ID = import.meta.env.VITE_GROUP_ID || null  // defina um UUID para compartilhar dados entre usuários

export default function App(){
  const [session, setSession] = useState(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgTone, setMsgTone] = useState('ok')
  const emailRef = useRef(null)

  const today = dayjs().format('YYYY-MM-DD')
  const [entries, setEntries] = useState([])

  // Form principal
  const [form, setForm] = useState({
    date: today, start: '07:00', end: '19:00', shift: 'Diurno',
    stage: 'Britagem', equipment: '', tonnage: '', moisture: '',
    operator: '', notes: '',
    stops: [{ id: uid(), from: '', to: '', cause: '' }],
    tph_target: '', grade: '',
  })
  const [allowEditTarget, setAllowEditTarget] = useState(false)

  // Filtros
  const [filters, setFilters] = useState({ from: today, to: today, stage: 'Todos', query: '' })

  // Equipamentos, metas
  const [equipments, setEquipments] = useState([])
  const [equipModal, setEquipModal] = useState(false)
  const [newEquip, setNewEquip] = useState({ code: '', stage: 'Britagem', active: true })
  const [targets, setTargets] = useState({ Britagem: 0, Moagem: 0 })

  // Ouro
  const [goldRecords, setGoldRecords] = useState([])
  const [goldMonth, setGoldMonth] = useState(dayjs().format('YYYY-MM'))
  const [goldKg, setGoldKg] = useState('')

  // QR
  const [qrOpen, setQrOpen] = useState(false)
  const qrInstanceRef = useRef(null)

  // Realtime & grupo
  const realtimeRef = useRef(null)
  const [members, setMembers] = useState([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState('member')
  const [inviteEmail, setInviteEmail] = useState('')
  const [updatingRole, setUpdatingRole] = useState('')

  /* ---------- Persistência local ---------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY); if (raw) setEntries(JSON.parse(raw))
      const eq = localStorage.getItem(STORAGE_EQUIP); if (eq) setEquipments(JSON.parse(eq))
      const tg = localStorage.getItem(STORAGE_TARGETS); if (tg) setTargets(JSON.parse(tg))
      const gr = localStorage.getItem(STORAGE_GOLD); if (gr) setGoldRecords(JSON.parse(gr))
    } catch {}
  }, [])
  useEffect(()=>{ localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)) }, [entries])
  useEffect(()=>{ localStorage.setItem(STORAGE_EQUIP, JSON.stringify(equipments)) }, [equipments])
  useEffect(()=>{ localStorage.setItem(STORAGE_TARGETS, JSON.stringify(targets)) }, [targets])
  useEffect(()=>{ localStorage.setItem(STORAGE_GOLD, JSON.stringify(goldRecords)) }, [goldRecords])

  useEffect(() => {
    if (equipments.length === 0){
      setEquipments([
        { id: uid(), code: 'BT-01', stage: 'Britagem', active: true },
        { id: uid(), code: 'MM-01', stage: 'Moagem', active: true },
        { id: uid(), code: 'MM-02', stage: 'Moagem', active: true },
      ])
    }
  }, [equipments.length])

  /* ---------- Autenticação ---------- */
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => { setSession(sess) })
    return () => { sub?.subscription.unsubscribe() }
  }, [])

  /* ---------- Helpers ---------- */
  function queuePending(op){
    if (op?.payload) op.payload = normalizePayload(op.payload)
    const raw = localStorage.getItem(STORAGE_PENDING)
    const list = raw ? JSON.parse(raw) : []
    list.push(op)
    localStorage.setItem(STORAGE_PENDING, JSON.stringify(list))
  }
  function normalizePayload(p){
    const q = { ...p }
    if (typeof q.stops_json === 'string') {
      try { q.stops_json = JSON.parse(q.stops_json) } catch { q.stops_json = [] }
    }
    const numKeys = ['tonnage','moisture','hours','tph','downtime_min','op_hours','tph_operational','tph_target','tph_delta','grade']
    for (const k of numKeys) {
      if (q[k] === '' || q[k] === undefined || q[k] === null) { delete q[k]; continue }
      const v = Number(q[k])
      if (Number.isNaN(v) || !Number.isFinite(v)) { delete q[k] } else { q[k] = v }
    }
    Object.keys(q).forEach(k => { if (q[k] === undefined || (typeof q[k] === 'number' && Number.isNaN(q[k]))) delete q[k] })
    return q
  }

  /* ---------- Cloud sync ---------- */
  async function fetchEntriesFromCloud() {
    if (!supabase || !session?.user) return
    const { data, error } = await supabase
      .from('production_entries')
      .select('*')
      .eq(GROUP_ID ? 'group_id' : 'user_id', GROUP_ID ? GROUP_ID : session.user.id)
      .order('date', { ascending: true })
    if (error) { setMsg('Falha ao buscar da nuvem: ' + (error.message || '')); setMsgTone('error'); return }
    setEntries((prev) => {
      const map = new Map(prev.map(e => [e.id, e]))
      for (const e of (data || [])) map.set(e.id, e)
      return Array.from(map.values()).sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.id).localeCompare(String(b.id)))
    })
  }
  function subscribeRealtime() {
    if (!supabase || !session?.user || realtimeRef.current) return
    realtimeRef.current = supabase
      .channel('prod_entries')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_entries', filter: GROUP_ID ? `group_id=eq.${GROUP_ID}` : `user_id=eq.${session.user.id}` }, () => { fetchEntriesFromCloud() })
      .subscribe()
  }
  async function flushPending(){
    if (!supabase || !session?.user) return
    const raw = localStorage.getItem(STORAGE_PENDING)
    const list = raw ? JSON.parse(raw) : []
    if (!list.length) { await fetchEntriesFromCloud(); return }
    setIsSyncing(true)
    try{
      for (const op of list){
        if (op.type === 'upsert') {
          const payload = normalizePayload({ ...op.payload, user_id: op.payload.user_id || session.user.id, group_id: GROUP_ID || op.payload.group_id })
          const up = await supabase.from('production_entries').upsert(payload, { onConflict: 'id' })
          if (up.error) {
            const ins = await supabase.from('production_entries').insert(payload)
            if (ins.error && ins.status !== 409) throw ins.error
          }
        } else if (op.type === 'delete') {
          const { error } = await supabase.from('production_entries').delete().eq('id', op.id)
          if (error) throw error
        }
      }
      localStorage.removeItem(STORAGE_PENDING)
      setMsg('Pendências sincronizadas.'); setMsgTone('ok')
    } catch (e){
      console.error('Supabase sync error:', e)
      setMsg('Erro ao sincronizar pendências: ' + (e?.message || e?.error_description || '400')); setMsgTone('error')
    } finally {
      setIsSyncing(false)
      await fetchEntriesFromCloud()
    }
  }

  useEffect(() => {
    (async () => {
      if (session?.user && supabase) {
        await flushPending()
        await fetchEntriesFromCloud()
        subscribeRealtime()
      }
    })()
  }, [session])

  useEffect(() => {
    return () => { if (realtimeRef.current) { try { supabase.removeChannel(realtimeRef.current) } catch {} ; realtimeRef.current = null } }
  }, [])

  /* ---------- Derivados ---------- */
  const totalStopsMin = useMemo(() => (form.stops||[]).reduce((acc,s)=>acc+(diffMinutes(s.from,s.to)||0),0), [form.stops])
  useEffect(() => {
    const t = Number((targets||{})[form.stage] || 0)
    setForm(prev => ({ ...prev, tph_target: t ? String(t) : '' }))
  }, [form.stage, targets])

  function addStop(){ setForm(prev => ({ ...prev, stops: [...prev.stops, { id: uid(), from: '', to: '', cause: '' }] })) }
  function removeStop(id){ setForm(prev => ({ ...prev, stops: prev.stops.filter(s => s.id !== id) })) }
  function updateStop(id, patch){ setForm(prev => ({ ...prev, stops: prev.stops.map(s => s.id === id ? { ...s, ...patch } : s) })) }

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

    const payload = normalizePayload({
      group_id: GROUP_ID,
      id: uid(),
      user_id: session?.user?.id || null,
      date: form.date, start: form.start, end: form.end, shift: form.shift, stage: form.stage,
      equipment: form.equipment, tonnage,
      moisture: form.moisture !== '' ? Number(form.moisture) : undefined,
      operator: cleanText(form.operator), notes: cleanText(form.notes),
      hours, tph,
      downtime_min: downtimeMin, downtime_cause: cleanText((form.stops||[]).map(s=>s.cause).filter(Boolean).join('; ')),
      op_hours: opHours, tph_operational: tphOperational,
      tph_target: form.tph_target !== '' ? Number(form.tph_target) : undefined,
      tph_delta: (form.tph_target && tphOperational) ? +(tphOperational - Number(form.tph_target)).toFixed(2) : undefined,
      grade: form.grade !== '' ? Number(form.grade) : undefined,
      stops_json: form.stops || []
    })

    setEntries(prev => [...prev, payload])

    try {
      if (supabase && session?.user) {
        const up = await supabase.from('production_entries').upsert(payload, { onConflict: 'id' })
        if (up.error) {
          const ins = await supabase.from('production_entries').insert(payload)
          if (ins.error && ins.status !== 409) throw ins.error
        }
        await fetchEntriesFromCloud()
      } else {
        queuePending({ type: 'upsert', payload })
      }
      setMsg('Lançamento adicionado.'); setMsgTone('ok')
    } catch (e) {
      console.error('Supabase upsert error:', e)
      queuePending({ type: 'upsert', payload })
      setMsg('Erro ao salvar no Supabase: ' + (e?.message || e?.error_description || '400') + ' — salvo offline para sincronizar depois.'); setMsgTone('error')
    }

    resetForm()
  }

  async function handleDelete(id){
    setEntries(prev => prev.filter(x => x.id !== id))
    try {
      if (supabase && session?.user) {
        const { error } = await supabase.from('production_entries').delete().eq('id', id)
        if (error) throw error
        await fetchEntriesFromCloud()
      } else {
        queuePending({ type: 'delete', id })
      }
      setMsg('Lançamento removido.'); setMsgTone('ok')
    } catch (e) {
      queuePending({ type: 'delete', id })
      setMsg('Erro ao remover no Supabase: ' + (e?.message || e?.error_description || '400') + ' — remoção pendente.'); setMsgTone('error')
    }
  }

  const equipByStage = useMemo(() => ({
    Britagem: equipments.filter(e => e.stage === 'Britagem' && e.active),
    Moagem: equipments.filter(e => e.stage === 'Moagem' && e.active),
  }), [equipments])

  const filtered = useMemo(() => {
    const f = filters
    const from = f.from ? dayjs(f.from) : null
    const to = f.to ? dayjs(f.to) : null
    return entries.filter((e) => {
      const d = dayjs(e.date)
      const matchDate = (!from || !d.isBefore(from)) && (!to || !d.isAfter(to))
      const matchStage = f.stage === 'Todos' || e.stage === f.stage
      const q = (f.query || '').toLowerCase()
      const matchQ = !q || [e.operator, e.equipment, e.notes, e.shift].some(x => (x || '').toLowerCase().includes(q))
      return matchDate && matchStage && matchQ
    }).sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.id).localeCompare(String(b.id)))
  }, [entries, filters])

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

  const stopsDaily = useMemo(() => {
    const map = new Map()
    for (const e of filtered){
      const d = e.date
      const m = Number(e.downtime_min || 0)
      map.set(d, (map.get(d) || 0) + m)
    }
    return Array.from(map.entries()).map(([date, minutes]) => ({ date, minutes })).sort((a,b)=>a.date<b.date?-1:1)
  }, [filtered])

  /* ---------- PDF ---------- */
  function renderSummaryHTML(from, to){
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
        <div><b>${APP_NAME}</b></div>
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

  async function captureNodeImageById(id){
    const node = document.getElementById(id)
    if (!node) return null
    const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff' })
    return canvas.toDataURL('image/png')
  }

  async function buildReportPDFBlob(){
    const pdf = new jsPDF('p','mm','a4')
    const pdfW = pdf.internal.pageSize.getWidth()
    const pdfH = pdf.internal.pageSize.getHeight()

    // 1) Sumário + tabela
    const summaryWrapper = document.createElement('div')
    summaryWrapper.innerHTML = renderSummaryHTML(filters.from, filters.to)
    document.body.appendChild(summaryWrapper)
    const sumCanvas = await html2canvas(summaryWrapper, { scale: 2, backgroundColor: '#ffffff' })
    const img = sumCanvas.toDataURL('image/png')
    const imgH = (sumCanvas.height * pdfW) / sumCanvas.width
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
    document.body.removeChild(summaryWrapper)

    // 2) Gráficos (cada um numa página)
    const chartIds = ['chart-daily','chart-tph','chart-moagem-equip','chart-britagem-equip','chart-stops']
    for (const id of chartIds){
      const dataUrl = await captureNodeImageById(id)
      if (!dataUrl) continue
      pdf.addPage()
      pdf.addImage(dataUrl, 'PNG', 0, 0, pdfW, pdfH)
    }

    return pdf.output('blob')
  }

  async function exportFullReportPDF(){
    const blob = await buildReportPDFBlob()
    const filename = `relatorio_com_graficos_${filters.from}_a_${filters.to}.pdf`
    const fileURL = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = fileURL; a.download = filename; a.click()
    URL.revokeObjectURL(fileURL)
  }

  async function shareFileOrDownload({ blob, filename, title, text, fallbackWhatsApp=false }){
    const file = new File([blob], filename, { type: 'application/pdf' })
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title, text })
      return
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
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
    const blob = await buildReportPDFBlob()
    await shareFileOrDownload({
      blob, filename: `relatorio_com_graficos_${filters.from}_a_${filters.to}.pdf`,
      title: `Relatório ${dayjs(filters.from).format('DD/MM')} a ${dayjs(filters.to).format('DD/MM')}`,
      text: `Relatório ${dayjs(filters.from).format('DD/MM')} a ${dayjs(filters.to).format('DD/MM')}`,
      fallbackWhatsApp: true
    })
  }
  async function sendPeriodEmail(){
    const blob = await buildReportPDFBlob()
    await shareFileOrDownload({
      blob, filename: `relatorio_com_graficos_${filters.from}_a_${filters.to}.pdf`,
      title: `Relatório ${dayjs(filters.from).format('DD/MM')} a ${dayjs(filters.to).format('DD/MM')}`,
      text: `Segue relatório (com gráficos) do período ${dayjs(filters.from).format('DD/MM')} a ${dayjs(filters.to).format('DD/MM')}.`
    })
  }

  /* ---------- QR ---------- */
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
      setMsg('Não foi possível acessar a câmera. Verifique permissões e HTTPS.'); setMsgTone('error')
      setQrOpen(false)
    }
  }
  function closeQR(){
    const inst = qrInstanceRef.current
    if (inst) { inst.stop().then(() => inst.clear()).catch(()=>{}); qrInstanceRef.current = null }
    setQrOpen(false)
  }

  /* ---------- CSV / Backup ---------- */
  function exportCSV(){
    const header = ['id','user_id','group_id','data','inicio','fim','turno','etapa','equipamento','toneladas','umidade_%','operador','observacoes','horas','t/h','paradas_min','causas','h_oper','t/h_oper','t/h_meta','Δ_vs_meta','teor_g_t','paradas_json']
    const rows = entries.map(e => [
      e.id, e.user_id || '', e.group_id || '', e.date, e.start || '', e.end || '', e.shift || '', e.stage, e.equipment || '',
      e.tonnage ?? '', e.moisture ?? '', e.operator || '', (e.notes || '').replaceAll('\n',' '),
      e.hours ?? '', e.tph ?? '', e.downtime_min ?? '', e.downtime_cause || '',
      e.op_hours ?? '', e.tph_operational ?? '', e.tph_target ?? '', e.tph_delta ?? '',
      e.grade ?? '', JSON.stringify(e.stops_json ?? [])
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
  reader.onload = async () => {
    try {
      const raw = JSON.parse(reader.result)
      if (!Array.isArray(raw)) throw new Error('Formato inválido')

      // normaliza + injeta GROUP_ID (se houver)
      const norm = raw.map(x => {
        const y = { ...x }
        if (!y.id) y.id = 'imp_' + uid()
        if (!y.stage) y.stage = 'Moagem'
        if (typeof y.stops_json === 'string') {
          try { y.stops_json = JSON.parse(y.stops_json) } catch { y.stops_json = [] }
        }
        // garante números válidos
        const numKeys = ['tonnage','moisture','hours','tph','downtime_min','op_hours','tph_operational','tph_target','tph_delta','grade']
        for (const k of numKeys) {
          if (y[k] === '' || y[k] === null || y[k] === undefined) { delete y[k]; continue }
          const v = Number(y[k])
          if (Number.isNaN(v) || !Number.isFinite(v)) delete y[k]; else y[k] = v
        }
        // injeta group_id padrão, se definido
        if (GROUP_ID && !y.group_id) y.group_id = GROUP_ID
        return y
      })

      // acrescenta localmente
      setEntries(prev => [...prev, ...norm])

      // enfileira para nuvem (será enviado ao clicar "Sincronizar")
      norm.forEach(item => {
        queuePending({ type: 'upsert', payload: item })
      })

      setMsg(`Importados ${norm.length} lançamentos. Clique em "Sincronizar" para enviar ao Supabase.`)
      setMsgTone('ok')
    } catch (e) {
      console.error(e)
      setMsg('Falha ao importar JSON. Verifique o arquivo.')
      setMsgTone('error')
    }
  }
  reader.readAsText(file)
}


  /* ---------- Ouro ---------- */
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
    setMsg('Resumo do ouro salvo para o mês.'); setMsgTone('ok')
  }

  /* ---------- Admin do Grupo (RPCs no Supabase) ---------- */
  async function refreshMembers(){
    if (!supabase || !session?.user || !GROUP_ID) return
    const { data, error } = await supabase.rpc('list_group_members', { p_group: GROUP_ID })
    if (error) { console.warn('list_group_members', error); return }
    setMembers(data || [])
    setIsAdmin( (data||[]).some(m => m.user_id === session.user.id && m.role === 'admin') )
  }
  async function addMember(){
    if (!addEmail.trim()) return setMsg('Informe um e-mail para adicionar.'), setMsgTone('error')
    const email = addEmail.trim()
    const { error } = await supabase.rpc('add_group_member_by_email', { p_group: GROUP_ID, p_email: email, p_role: addRole })
    if (error) { setMsg('Falha ao adicionar: ' + (error.message || '')); setMsgTone('error'); return }
    setAddEmail(''); setAddRole('member'); setMsg('Membro adicionado/atualizado.'); setMsgTone('ok')
    await refreshMembers()
  }
  async function removeMember(email){
    if (!confirm(`Remover ${email} do grupo?`)) return
    const { error } = await supabase.rpc('remove_group_member_by_email', { p_group: GROUP_ID, p_email: email })
    if (error) { setMsg('Falha ao remover: ' + (error.message || '')); setMsgTone('error'); return }
    setMsg('Membro removido.'); setMsgTone('ok')
    await refreshMembers()
  }
  async function inviteByEmail(){
    if (!isAdmin) return setMsg('Apenas admin pode convidar.'), setMsgTone('error')
    const email = inviteEmail.trim()
    if (!email) return setMsg('Informe um e-mail para convite.'), setMsgTone('error')
    if (!supabase) return setMsg('Supabase não configurado.'), setMsgTone('error')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href }
    })
    if (error) { setMsg('Falha ao enviar convite: ' + (error.message || '')); setMsgTone('error'); return }
    setMsg('Convite enviado! Peça para o usuário abrir o e-mail.'); setMsgTone('ok')
    setInviteEmail('')
  }
  async function updateMemberRole(email, role){
    if (!isAdmin) return setMsg('Apenas admin pode alterar papéis.'), setMsgTone('error')
    try{
      setUpdatingRole(email)
      const { error } = await supabase.rpc('add_group_member_by_email', { p_group: GROUP_ID, p_email: email, p_role: role })
      if (error) throw error
      setMsg('Papel atualizado.'); setMsgTone('ok')
      await refreshMembers()
    } catch(e){
      setMsg('Falha ao atualizar papel: ' + (e.message || '')); setMsgTone('error')
    } finally {
      setUpdatingRole('')
    }
  }

  /* ---------- UI ---------- */
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Message text={msg} tone={msgTone} onClose={() => setMsg('')} />

      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-3">
          <div className="p-2 rounded-xl bg-slate-100"><Factory className="h-6 w-6" /></div>
          <div className="flex-1">
            <h1 className="text-xl md:text-2xl font-bold leading-tight">{APP_NAME} – Lançamentos & Dash</h1>
            <p className="text-sm text-slate-500">Britagem e Moagem separados · Período livre · PWA offline · QR · PDF (com gráficos) · Synced</p>
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
              <span>Conectado: <b>{session.user.email || session.user.id}</b>{GROUP_ID ? <span className="ml-2 px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-xs">Grupo</span> : null}</span>
              <button className="px-3 py-2 border rounded-md text-sm hover:bg-slate-50" onClick={async()=>{ await supabase.auth.signOut(); setSession(null) }}><LogOut className="inline mr-2 h-4 w-4"/>Sair</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-slate-400"/>
              <input ref={emailRef} type="email" placeholder="seu@email.com" className="w-64 px-3 py-2 border rounded-md"/>
              <button className="px-3 py-2 rounded-md text-white bg-slate-900 hover:bg-slate-800" onClick={async()=>{
                if (!supabase) { setMsg('Configure as variáveis do Supabase para autenticar.'); setMsgTone('error'); return }
                const email = emailRef.current?.value?.trim()
                if (!email) return setMsg('Informe um e-mail válido.'), setMsgTone('error')
                const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } })
                if (error) { setMsg('Falha ao enviar link. Verifique o e-mail.'); setMsgTone('error'); return }
                setMsg('Link de acesso enviado ao e-mail.'); setMsgTone('ok')
              }}><LogIn className="inline mr-2 h-4 w-4"/>Entrar por e-mail</button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Coluna esquerda: formulário */}
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
                      <button type="button" className="px-2 py-1 border rounded hover:bg-slate-50" onClick={()=>removeStop(s.id)}>Remover</button>
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

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pt-2">
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

        {/* Coluna direita: dashboard e admin */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KPI icon={<Hammer className="h-5 w-5"/>} title="Britagem (filtro)" value={`${formatNumber(sums.britF)} t`} />
            <KPI icon={<Hammer className="h-5 w-5"/>} title="Moagem (filtro)" value={`${formatNumber(sums.moagF)} t`} />
            <KPI icon={<CalendarRange className="h-5 w-5"/>} title="Hoje – Britagem" value={`${formatNumber(sums.britHoje)} t`} />
            <KPI icon={<CalendarRange className="h-5 w-5"/>} title="Hoje – Moagem" value={`${formatNumber(sums.moagHoje)} t`} />
            <KPI icon={<CalendarRange className="h-5 w-5"/>} title="Mês – Moagem" value={`${formatNumber(sums.moagMes)} t`} />
          </div>

          {/* Filtros período */}
          <div className="rounded-2xl border bg-white shadow-sm p-3">
            <div className="grid md:grid-cols-6 gap-2 items-end">
              <div><label className="text-sm">De</label><input type="date" className="w-full px-3 py-2 border rounded-md" value={filters.from} onChange={e=>setFilters({...filters, from:e.target.value})} /></div>
              <div><label className="text-sm">Até</label><input type="date" className="w-full px-3 py-2 border rounded-md" value={filters.to} onChange={e=>setFilters({...filters, to:e.target.value})} /></div>
              <div><label className="text-sm">Etapa</label><select className="w-full px-3 py-2 border rounded-md" value={filters.stage} onChange={e=>setFilters({...filters, stage:e.target.value})}><option>Todos</option><option>Britagem</option><option>Moagem</option></select></div>
              <div className="md:col-span-2"><label className="text-sm">Busca</label><input className="w-full px-3 py-2 border rounded-md" placeholder="operador, equipamento, observação..." value={filters.query} onChange={e=>setFilters({...filters, query:e.target.value})} /></div>
              <div className="flex gap-2">
                <button className="px-3 py-2 border rounded-md hover:bg-slate-50" onClick={()=>setFilters({ from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().endOf('month').format('YYYY-MM-DD'), stage: 'Todos', query: '' })}><Filter className="inline h-4 w-4 mr-1"/>Este mês</button>
                <button className="px-3 py-2 border rounded-md hover:bg-slate-50" onClick={()=>setFilters({ from: dayjs().format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD'), stage: 'Todos', query: '' })}><Filter className="inline h-4 w-4 mr-1"/>Hoje</button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border bg-white shadow-sm" id="chart-daily">
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

          <div className="rounded-2xl border bg-white shadow-sm" id="chart-tph">
            <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><BarChart3 className="h-5 w-5"/> t/h operacional (colunas)</div>
            <div className="h-72 px-2 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={tphOperationalSeries} margin={{ left: 4, right: 16, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" /><YAxis /><Tooltip /><Legend />
                  <Bar dataKey="t/h Britagem" fill="#3b82f6" />
                  <Bar dataKey="t/h Moagem" fill="#10b981" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-2xl border bg-white shadow-sm" id="chart-moagem-equip">
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
            <div className="rounded-2xl border bg-white shadow-sm" id="chart-britagem-equip">
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

          <div className="rounded-2xl border bg-white shadow-sm" id="chart-stops">
            <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><BarChart3 className="h-5 w-5"/> Paradas por dia (minutos)</div>
            <div className="h-72 px-2 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={stopsDaily} margin={{ left: 4, right: 16, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" /><YAxis /><Tooltip /><Legend />
                  <Bar dataKey="minutes" name="Paradas (min)" fill="#ef4444" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Admin do Grupo */}
          {GROUP_ID && session?.user && (
            <div className="rounded-2xl border bg-white shadow-sm">
              <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2">
                <Users className="h-5 w-5"/> Admin do Grupo
                {!isAdmin && <span className="text-xs ml-2 px-2 py-0.5 rounded bg-slate-100 text-slate-500 flex items-center gap-1"><Shield className="h-3 w-3"/>somente leitura</span>}
              </div>
              <div className="px-4 pb-3">
                {isAdmin ? (
                  <div className="grid md:grid-cols-3 gap-2 items-end">
                    <div>
                      <label className="text-sm">E-mail do novo membro</label>
                      <input className="w-full px-3 py-2 border rounded-md" placeholder="usuario@empresa.com" value={addEmail} onChange={e=>setAddEmail(e.target.value)} />
                      <p className="text-xs text-slate-500 mt-1">Peça para a pessoa abrir o app e fazer login pelo menos uma vez antes de adicioná-la.</p>
                    </div>
                    <div>
                      <label className="text-sm">Papel</label>
                      <select className="w-full px-3 py-2 border rounded-md" value={addRole} onChange={e=>setAddRole(e.target.value)}>
                        <option value="member">Membro</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    <div className="flex md:justify-end">
                      <button className="px-3 py-2 rounded-md text-white bg-slate-900 hover:bg-slate-800" onClick={addMember}><Save className="inline mr-2 h-4 w-4"/>Adicionar/atualizar</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">Você não é admin deste grupo. Peça a um admin para te dar permissão.</p>
                )}
              </div>
              {isAdmin && (
                <div className="px-4 pb-3">
                  <div className="grid md:grid-cols-3 gap-2 items-end">
                    <div>
                      <label className="text-sm">Convidar por e-mail (envia link mágico)</label>
                      <input className="w-full px-3 py-2 border rounded-md" placeholder="novo@empresa.com" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} />
                      <p className="text-xs text-slate-500 mt-1">O convidado precisa abrir o e-mail e clicar no link para criar a conta.</p>
                    </div>
                    <div className="md:col-span-2 flex md:justify-end">
                      <button className="px-3 py-2 rounded-md text-white bg-slate-900 hover:bg-slate-800" onClick={inviteByEmail}><Send className="inline mr-2 h-4 w-4"/>Enviar convite</button>
                    </div>
                  </div>
                </div>
              )}
              <div className="px-4 pb-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-500"><tr className="border-b"><th className="py-2 pr-3">E-mail</th><th className="py-2 pr-3">Papel</th><th className="py-2 pr-3 text-right">Ações</th></tr></thead>
                  <tbody>
                    {(members||[]).map(m => (
                      <tr key={m.user_id} className="border-b">
                        <td className="py-2 pr-3">{m.email}</td>
                        <td className="py-2 pr-3">
                          {isAdmin ? (
                            <div className="flex items-center gap-2">
                              <select
                                className="px-2 py-1 border rounded-md"
                                value={m.role}
                                onChange={(e)=>updateMemberRole(m.email, e.target.value)}
                                disabled={updatingRole===m.email}
                              >
                                <option value="member">member</option>
                                <option value="admin">admin</option>
                              </select>
                            </div>
                          ) : m.role}
                        </td>
                        <td className="py-2 pr-0 text-right">
                          {isAdmin && m.user_id !== session.user.id && (
                            <button className="px-2 py-1 border rounded hover:bg-slate-50 text-red-600" onClick={()=>removeMember(m.email)} title="Remover"><Trash2 className="h-4 w-4"/></button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {(!members || members.length === 0) && <tr><td colSpan="3" className="py-6 text-center text-slate-400">Sem membros cadastrados.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><FileText className="h-5 w-5"/> Lançamentos (período aplicado)</div>
            <div className="px-4 pb-3 flex items-center gap-2">
              <button className="px-3 py-2 rounded-md text-white bg-slate-900 hover:bg-slate-800" onClick={exportFullReportPDF}><FileText className="inline h-4 w-4 mr-1"/>PDF do Período (com gráficos)</button>
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
                  {filtered.length === 0 && (<tr><td colSpan="15" className="py-8 text-center text-slate-400">Sem lançamentos para os filtros aplicados.</td></tr>)}
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

          {/* Ouro */}
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><Star className="h-5 w-5"/> Resumo do Ouro</div>
            <div className="px-4 pb-4 grid md:grid-cols-5 gap-3">
              <div><label className="text-sm">Mês</label><input type="month" className="w-full px-3 py-2 border rounded-md" value={goldMonth} onChange={e=>setGoldMonth(e.target.value)} /></div>
              <div><label className="text-sm">Ouro recuperado (kg)</label><input type="number" step="0.001" className="w-full px-3 py-2 border rounded-md" value={goldKg} onChange={e=>setGoldKg(e.target.value)} /></div>
              <div className="md:col-span-3 flex items-center gap-2">
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
        </div>
      </main>

      {/* Modais */}
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
              <div className="pt-2 flex justify-end"><button className="px-3 py-2 rounded-md text-white bg-slate-900 hover:bg-slate-800" onClick={()=>{ if (!newEquip.code.trim()) return; setEquipments(prev => [...prev, { id: uid(), code: newEquip.code.trim().toUpperCase(), stage: newEquip.stage, active: !!newEquip.active }]); setNewEquip({ code: '', stage: 'Britagem', active: true }); setEquipModal(false); }}><Save className="inline h-4 w-4 mr-1"/>Salvar</button></div>
            </div>
          </div>
        </div>
      )}

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

      <footer className="mx-auto max-w-7xl px-4 pb-8 pt-2 text-xs text-slate-500">
        <div><b>Período livre:</b> ajuste "De/Até" para ver os gráficos no intervalo desejado. O PDF agora inclui <b>todos os gráficos</b>, inclusive <b>Paradas (min)</b>.</div>
      </footer>
    </div>
  )
}
