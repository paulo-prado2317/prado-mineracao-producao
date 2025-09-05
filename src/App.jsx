
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { BarChart3, CalendarRange, Download, Edit, Factory, Filter, Hammer, LogIn, LogOut, Mail, Plus, RefreshCw, Save, Search, Trash2, Upload, Cloud, Database } from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import KPI from '@/components/KPI'
import ClockIcon from '@/components/ClockIcon'
import Message from '@/components/Message'

// ------------------------------
// Utilidades & Constantes
// ------------------------------
const STORAGE_KEY = 'prado_mineracao_producao_vite_v1'
const STORAGE_PENDING = 'prado_mineracao_pending_queue_v1'

function uid(){ return Math.random().toString(36).slice(2) + Date.now().toString(36) }
function parseTimeToHours(start, end){
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins < 0) mins += 24 * 60
  return +(mins / 60).toFixed(2)
}
function formatNumber(n){
  if (n === undefined || n === null || isNaN(n)) return '0'
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(Number(n))
}

// ------------------------------
// Supabase Client (lê envs Vite)
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

  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    start: '07:00',
    end: '19:00',
    shift: 'Diurno',
    stage: 'Britagem',
    equipment: '',
    tonnage: '',
    moisture: '',
    operator: '',
    notes: '',
  })
  const [filters, setFilters] = useState({
    from: new Date().toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
    stage: 'Todos',
    query: '',
  })
  const emailRef = useRef(null)

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
    const map = new Map()
    ;[...a, ...b].forEach(x => map.set(x.id, { ...map.get(x.id), ...x }))
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
    } finally {
      setIsSyncing(false)
    }
  }
  useEffect(() => {
    const onOnline = () => flushPending()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [session])

  function mapToCloud(e){
    const user_id = session?.user?.id || null
    return {
      id: e.id,
      user_id,
      date: e.date,
      start: e.start || null,
      end: e.end || null,
      shift: e.shift || null,
      stage: e.stage,
      equipment: e.equipment || null,
      tonnage: e.tonnage ?? null,
      moisture: e.moisture ?? null,
      operator: e.operator || null,
      notes: e.notes || null,
      hours: e.hours ?? null,
      tph: e.tph ?? null,
    }
  }
  function mapFromCloud(r){
    return {
      id: r.id,
      date: r.date,
      start: r.start || '',
      end: r.end || '',
      shift: r.shift || '',
      stage: r.stage,
      equipment: r.equipment || '',
      tonnage: Number(r.tonnage ?? 0),
      moisture: r.moisture !== null && r.moisture !== undefined ? Number(r.moisture) : undefined,
      operator: r.operator || '',
      notes: r.notes || '',
      hours: r.hours !== null && r.hours !== undefined ? Number(r.hours) : undefined,
      tph: r.tph !== null && r.tph !== undefined ? Number(r.tph) : undefined,
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
      date: new Date().toISOString().slice(0, 10),
      start: '07:00',
      end: '19:00',
      shift: 'Diurno',
      stage: 'Britagem',
      equipment: '',
      tonnage: '',
      moisture: '',
      operator: '',
      notes: '',
    })
    setEditingId(null)
  }

  async function handleSubmit(e){
    e.preventDefault()
    const hours = parseTimeToHours(form.start, form.end)
    const tonnage = Number(form.tonnage || 0)

    const payload = {
      id: editingId || uid(),
      date: form.date,
      start: form.start,
      end: form.end,
      shift: form.shift,
      stage: form.stage,
      equipment: form.equipment?.trim(),
      tonnage,
      moisture: form.moisture !== '' ? Number(form.moisture) : undefined,
      operator: form.operator?.trim(),
      notes: form.notes?.trim(),
      hours,
      tph: hours > 0 ? +(tonnage / hours).toFixed(2) : undefined,
      createdAt: editingId ? undefined : new Date().toISOString(),
    }

    setEntries(prev => {
      const exists = prev.find(x => x.id === payload.id)
      if (exists) return prev.map(x => x.id === payload.id ? { ...exists, ...payload } : x)
      return [...prev, payload]
    })

    try {
      if (supabase && session?.user) {
        await upsertCloud(payload)
      } else {
        queuePending({ type: 'upsert', payload })
      }
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
      if (supabase && session?.user) {
        await deleteCloud(id)
      } else {
        queuePending({ type: 'delete', id })
      }
      setMsg('Lançamento removido.')
    } catch (_) {
      queuePending({ type: 'delete', id })
      setMsg('Sem conexão. Remoção pendente para sincronizar.')
    }
  }

  function handleEdit(id){
    const e = entries.find(x => x.id === id)
    if (!e) return
    setEditingId(id)
    setForm({
      date: e.date,
      start: e.start || '07:00',
      end: e.end || '19:00',
      shift: e.shift || 'Diurno',
      stage: e.stage,
      equipment: e.equipment || '',
      tonnage: e.tonnage?.toString() || '',
      moisture: e.moisture?.toString() || '',
      operator: e.operator || '',
      notes: e.notes || '',
    })
  }

  function exportCSV(){
    const header = ['id','data','inicio','fim','turno','etapa','equipamento','toneladas','umidade_%','operador','observacoes','horas','tph','criado_em']
    const rows = entries.map(e => [
      e.id, e.date, e.start || '', e.end || '', e.shift || '', e.stage, e.equipment || '',
      e.tonnage ?? '', e.moisture ?? '', e.operator || '', (e.notes || '').replaceAll('\n',' '),
      e.hours ?? '', e.tph ?? '', e.createdAt || ''
    ])
    const csv = [header, ...rows].map(r => r.map(c => c==null? '' : String(c)).map(c => `"${c.replaceAll('"','""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `producao_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
  function backupJSON(){
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `backup_producao_${new Date().toISOString().replaceAll(':','-')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  function importJSON(file){
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result)
        if (!Array.isArray(data)) throw new Error('Formato inválido')
        setEntries(data)
        setMsg('Backup importado com sucesso.')
      } catch (e) {
        setMsg('Falha ao importar JSON.')
      }
    }
    reader.readAsText(file)
  }

  const filtered = useMemo(() => {
    const from = filters.from ? new Date(filters.from) : null
    const to = filters.to ? new Date(filters.to) : null
    return entries.filter(e => {
      const d = new Date(e.date)
      const matchDate = (!from || d >= from) && (!to || d <= to)
      const matchStage = filters.stage === 'Todos' || e.stage === filters.stage
      const q = filters.query.toLowerCase()
      const matchQ = !q || [e.operator, e.equipment, e.notes, e.shift].some(x => (x || '').toLowerCase().includes(q))
      return matchDate && matchStage && matchQ
    }).sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
  }, [entries, filters])

  const kpis = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10)
    const monthStr = todayStr.slice(0, 7)
    const sum = (arr, fn) => arr.reduce((acc, x) => acc + (fn(x) || 0), 0)
    const total = sum(filtered, x => x.tonnage)
    const totalBrit = sum(filtered.filter(x => x.stage === 'Britagem'), x => x.tonnage)
    const totalMoag = sum(filtered.filter(x => x.stage === 'Moagem'), x => x.tonnage)
    const today = entries.filter(x => x.date === todayStr)
    const todayT = sum(today, x => x.tonnage)
    const month = entries.filter(x => x.date.startsWith(monthStr))
    const monthT = sum(month, x => x.tonnage)
    return { total, totalBrit, totalMoag, todayT, monthT }
  }, [entries, filtered])

  const chartData = useMemo(() => {
    const map = new Map()
    for (const e of filtered){
      if (!map.has(e.date)) map.set(e.date, { date: e.date, Britagem: 0, Moagem: 0 })
      map.get(e.date)[e.stage] += e.tonnage || 0
    }
    return Array.from(map.values()).sort((a,b) => a.date < b.date ? -1 : 1)
  }, [filtered])

  async function signInWithEmail(){
    if (!supabase) { setMsg('Configure as variáveis do Supabase para autenticar.'); return }
    const email = emailRef.current?.value?.trim()
    if (!email) return setMsg('Informe um e-mail válido.')
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } })
    if (error) return setMsg('Falha ao enviar link. Verifique o e-mail.')
    setMsg('Link de acesso enviado ao e-mail.')
  }
  async function signOut(){
    if (!supabase) return
    await supabase.auth.signOut()
    setSession(null)
  }
  async function manualSync(){
    if (!session?.user) { setMsg('Entre para sincronizar com a nuvem.'); return }
    setIsSyncing(true)
    try {
      await flushPending()
      for (const e of entries) await upsertCloud(e)
      await fetchCloudEntries(session.user.id)
      setMsg('Sincronização concluída.')
    } finally { setIsSyncing(false) }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Message text={msg} onClose={() => setMsg('')} />
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-3">
          <div className="p-2 rounded-xl bg-slate-100"><Factory className="h-6 w-6" /></div>
          <div className="flex-1">
            <h1 className="text-xl md:text-2xl font-bold leading-tight">Lançamentos de Produção – Mineração</h1>
            <p className="text-sm text-slate-500">Registre Britagem e Moagem. Offline-first + Supabase sync.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-2 border rounded-md text-sm hover:bg-slate-50" onClick={exportCSV}><Download className="inline mr-2 h-4 w-4"/>CSV</button>
            <button className="px-3 py-2 border rounded-md text-sm hover:bg-slate-50" onClick={backupJSON}><Save className="inline mr-2 h-4 w-4"/>Backup</button>
            <label className="inline-flex items-center gap-2 px-4 py-2 border rounded-md text-sm cursor-pointer hover:bg-slate-50">
              <Upload className="h-4 w-4"/> Importar
              <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importJSON(e.target.files[0])} />
            </label>
            <button className="px-3 py-2 rounded-md text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60" onClick={manualSync} disabled={isSyncing}><Cloud className="inline mr-2 h-4 w-4"/>{isSyncing ? 'Sincronizando...' : 'Sincronizar'}</button>
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-4 pb-3 flex items-center justify-between gap-3">
          {session?.user ? (
            <div className="text-sm text-slate-600 flex items-center gap-3">
              <Database className="h-4 w-4"/>
              <span>Conectado: <b>{session.user.email || session.user.id}</b></span>
              <button className="px-3 py-2 border rounded-md text-sm hover:bg-slate-50" onClick={signOut}><LogOut className="inline mr-2 h-4 w-4"/>Sair</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-slate-400"/>
              <input ref={emailRef} type="email" placeholder="seu@email.com" className="w-64 px-3 py-2 border rounded-md"/>
              <button className="px-3 py-2 rounded-md text-white bg-slate-900 hover:bg-slate-800" onClick={signInWithEmail}><LogIn className="inline mr-2 h-4 w-4"/>Entrar por e-mail</button>
              {(!SUPABASE_URL || !SUPABASE_ANON) ? (<span className="text-xs text-amber-600 ml-2">Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY</span>) : null}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Form */}
        <div className="rounded-2xl border bg-white shadow-sm p-4">
          <div className="text-lg font-semibold flex items-center gap-2 mb-3"><Plus className="h-5 w-5"/> Novo Lançamento</div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm">Data</label>
                <input type="date" className="w-full px-3 py-2 border rounded-md" value={form.date} onChange={e=>setForm({...form, date:e.target.value})} required />
              </div>
              <div>
                <label className="text-sm">Turno</label>
                <select className="w-full px-3 py-2 border rounded-md" value={form.shift} onChange={e=>setForm({...form, shift:e.target.value})}>
                  <option>Diurno</option><option>Noturno</option><option>A</option><option>B</option><option>C</option>
                </select>
              </div>
              <div>
                <label className="text-sm">Início</label>
                <input type="time" className="w-full px-3 py-2 border rounded-md" value={form.start} onChange={e=>setForm({...form, start:e.target.value})} />
              </div>
              <div>
                <label className="text-sm">Fim</label>
                <input type="time" className="w-full px-3 py-2 border rounded-md" value={form.end} onChange={e=>setForm({...form, end:e.target.value})} />
              </div>
              <div>
                <label className="text-sm">Etapa</label>
                <select className="w-full px-3 py-2 border rounded-md" value={form.stage} onChange={e=>setForm({...form, stage:e.target.value})}>
                  <option>Britagem</option>
                  <option>Moagem</option>
                </select>
              </div>
              <div>
                <label className="text-sm">Equipamento</label>
                <input className="w-full px-3 py-2 border rounded-md" placeholder="Ex.: Britador 01 / Moinho 02" value={form.equipment} onChange={e=>setForm({...form, equipment:e.target.value})} />
              </div>
              <div>
                <label className="text-sm">Toneladas (t)</label>
                <input type="number" step="0.01" inputMode="decimal" className="w-full px-3 py-2 border rounded-md" value={form.tonnage} onChange={e=>setForm({...form, tonnage:e.target.value})} required />
              </div>
              <div>
                <label className="text-sm">Umidade (%)</label>
                <input type="number" step="0.1" inputMode="decimal" className="w-full px-3 py-2 border rounded-md" value={form.moisture} onChange={e=>setForm({...form, moisture:e.target.value})} />
              </div>
              <div>
                <label className="text-sm">Operador</label>
                <input className="w-full px-3 py-2 border rounded-md" value={form.operator} onChange={e=>setForm({...form, operator:e.target.value})} />
              </div>
              <div className="col-span-2">
                <label className="text-sm">Observações</label>
                <textarea rows="3" className="w-full px-3 py-2 border rounded-md" value={form.notes} onChange={e=>setForm({...form, notes:e.target.value})}></textarea>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="text-sm text-slate-500 flex items-center gap-2"><ClockIcon/>{
                (()=>{
                  const h = parseTimeToHours(form.start, form.end)
                  const tph = Number(form.tonnage || 0) && h ? (Number(form.tonnage)/h) : 0
                  return <span>{h} h • {tph ? tph.toFixed(2) : '0.00'} t/h</span>
                })()
              }</div>
              <div className="flex gap-2">
                <button type="button" className="px-3 py-2 border rounded-md text-sm hover:bg-slate-50" onClick={resetForm}><RefreshCw className="inline mr-2 h-4 w-4"/>Limpar</button>
                <button type="submit" className="px-3 py-2 rounded-md text-white bg-slate-900 hover:bg-slate-800"><Save className="inline mr-2 h-4 w-4"/>{editingId ? 'Salvar' : 'Adicionar'}</button>
              </div>
            </div>
          </form>
        </div>

        {/* KPIs + Gráfico + Lista */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KPI icon={<BarChart3 className="h-5 w-5"/>} title="Total (filtro)" value={`${formatNumber(kpis.total)} t`} />
            <KPI icon={<Hammer className="h-5 w-5"/>} title="Britagem" value={`${formatNumber(kpis.totalBrit)} t`} />
            <KPI icon={<Hammer className="h-5 w-5"/>} title="Moagem" value={`${formatNumber(kpis.totalMoag)} t`} />
            <KPI icon={<CalendarRange className="h-5 w-5"/>} title="Hoje" value={`${formatNumber(kpis.todayT)} t`} />
            <KPI icon={<CalendarRange className="h-5 w-5"/>} title="Mês" value={`${formatNumber(kpis.monthT)} t`} />
          </div>

          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><BarChart3 className="h-5 w-5"/> Produção por dia (Britagem x Moagem)</div>
            <div className="h-72 px-2 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ left: 4, right: 16, bottom: 8 }}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.6}/>
                      <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.05}/>
                    </linearGradient>
                    <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#34d399" stopOpacity={0.6}/>
                      <stop offset="95%" stopColor="#34d399" stopOpacity={0.05}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="Britagem" stroke="#3b82f6" fill="url(#g1)" />
                  <Area type="monotone" dataKey="Moagem" stroke="#10b981" fill="url(#g2)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="px-4 py-3 text-lg font-semibold flex items-center gap-2"><Filter className="h-5 w-5"/> Filtros & Lançamentos</div>
            <div className="px-4 pb-3 grid md:grid-cols-5 gap-3">
              <div>
                <label className="text-sm">De</label>
                <input type="date" className="w-full px-3 py-2 border rounded-md" value={filters.from} onChange={e=>setFilters({...filters, from:e.target.value})} />
              </div>
              <div>
                <label className="text-sm">Até</label>
                <input type="date" className="w-full px-3 py-2 border rounded-md" value={filters.to} onChange={e=>setFilters({...filters, to:e.target.value})} />
              </div>
              <div>
                <label className="text-sm">Etapa</label>
                <select className="w-full px-3 py-2 border rounded-md" value={filters.stage} onChange={e=>setFilters({...filters, stage:e.target.value})}>
                  <option>Todos</option><option>Britagem</option><option>Moagem</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-sm">Busca</label>
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-slate-400"/>
                  <input className="w-full px-3 py-2 border rounded-md" placeholder="Operador, equipamento, notas..." value={filters.query} onChange={e=>setFilters({...filters, query:e.target.value})} />
                </div>
              </div>
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
                    <th className="py-2 pr-3 text-right">t/h</th>
                    <th className="py-2 pr-3">Operador</th>
                    <th className="py-2 pr-3">Observações</th>
                    <th className="py-2 pr-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan="10" className="py-8 text-center text-slate-400">Sem lançamentos para os filtros aplicados.</td></tr>
                  )}
                  {filtered.map(e => (
                    <tr key={e.id} className="border-b hover:bg-slate-50">
                      <td className="py-2 pr-3 whitespace-nowrap">{e.date}</td>
                      <td className="py-2 pr-3">{e.stage}</td>
                      <td className="py-2 pr-3">{e.shift || '—'}</td>
                      <td className="py-2 pr-3">{e.equipment || '—'}</td>
                      <td className="py-2 pr-3 text-right">{formatNumber(e.tonnage)}</td>
                      <td className="py-2 pr-3 text-right">{e.hours ? formatNumber(e.hours) : '—'}</td>
                      <td className="py-2 pr-3 text-right">{e.tph ? formatNumber(e.tph) : '—'}</td>
                      <td className="py-2 pr-3">{e.operator || '—'}</td>
                      <td className="py-2 pr-3 max-w-[28ch] truncate" title={e.notes}>{e.notes || '—'}</td>
                      <td className="py-2 pr-0 text-right">
                        <div className="flex gap-2 justify-end">
                          <button className="px-2 py-1 border rounded hover:bg-slate-50" onClick={()=>handleEdit(e.id)} title="Editar"><Edit className="h-4 w-4"/></button>
                          <button className="px-2 py-1 border rounded hover:bg-slate-50 text-red-600" onClick={()=>handleDelete(e.id)} title="Excluir"><Trash2 className="h-4 w-4"/></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-8 pt-2 text-xs text-slate-500 space-y-1">
        <div><b>Dica:</b> defina as variáveis do Supabase em <code>.env</code> antes de usar a nuvem. O app funciona offline e sincroniza quando você clicar em <b>Sincronizar</b>.</div>
      </footer>
    </div>
  )
}
