import xlsx from 'xlsx'
import dayjs from 'dayjs'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs'

/* ---------- Helpers ---------- */
function stripAccents(s){
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}
function normalizeKey(k){
  if (!k) return ''
  let s = String(k).trim()
  s = stripAccents(s).toUpperCase()
  s = s.replace(/[^\w\s/()%-]/g, ' ')   // remove símbolos estranhos (mantém /()% -)
  s = s.replace(/\s+/g, ' ').trim()
  return s
}
/** Trata números BR e remove unidades (t, ton, kg, etc) */
function parseNumberBR(val){
  if (val == null || val === '') return null
  if (typeof val === 'number') return Number.isFinite(val) ? val : null
  let s = String(val).trim()
  // remove unidades/labels
  s = s.replace(/[a-zA-Z]+/g, ' ')
  // remove símbolos exceto dígitos, vírgula, ponto, sinal
  s = s.replace(/[^\d.,-]/g, ' ')
  s = s.replace(/\s+/g, '')
  if (!s) return null
  // vírgula decimal BR
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (s.includes(',')) {
    s = s.replace(',', '.')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
function toDateStr(v) {
  if (!v) return null
  if (v instanceof Date) return dayjs(v).format('YYYY-MM-DD')
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD') : null
}
function toHHMM(v) {
  if (!v) return null
  if (v instanceof Date) return dayjs(v).format('HH:mm')
  if (typeof v === 'number') {
    const totalMin = Math.round(v * 24 * 60) // fração do dia
    const hh = Math.floor((totalMin / 60) % 24)
    const mm = totalMin % 60
    return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`
  }
  const s = String(v).trim()
  if (s.includes(':')) {
    const [h, m] = s.split(':')
    const hh = String(parseInt(h||'0',10)).padStart(2,'0')
    const mm = String(parseInt(m||'0',10)).padStart(2,'0')
    return `${hh}:${mm}`
  }
  return null
}
function timeToHours(v) {
  if (!v) return null
  if (v instanceof Date) return +(v.getHours() + v.getMinutes()/60).toFixed(4)
  if (typeof v === 'number') return +(v * 24).toFixed(4) // fração do dia
  const s = String(v).trim()
  if (s.includes(':')) {
    const [h, m] = s.split(':')
    return +(parseInt(h||'0',10) + (parseInt(m||'0',10)/60)).toFixed(4)
  }
  const n = parseNumberBR(s)
  return n != null ? +n.toFixed(4) : null
}
function timeToMinutes(v) {
  const h = timeToHours(v)
  return h == null ? null : Math.round(h * 60)
}
function mapStage(s) {
  const t = normalizeKey(s)
  if (t === 'BRITAGEM') return 'Britagem'
  if (t === 'MOAGEM') return 'Moagem'
  return t ? (t[0] + t.slice(1).toLowerCase()) : 'Moagem'
}
function mapShift(s) {
  const t = normalizeKey(s)
  if (t === 'DIURNO') return 'Diurno'
  if (t === 'NOTURNO') return 'Noturno'
  return t ? (t[0] + t.slice(1).toLowerCase()) : null
}

/* ---------- Leitura ---------- */
const inputFile = process.argv[2] || 'PARA IMPORTAR.xlsx'
const DEBUG = process.argv.includes('--debug')
const wb = xlsx.readFile(inputFile, { cellDates: true })
const sh = wb.Sheets[wb.SheetNames[0]]
const rows = xlsx.utils.sheet_to_json(sh, { defval: null, raw: true })

// Mapeia cabeçalhos originais -> normalizados
const headerRow = xlsx.utils.sheet_to_json(sh, { header: 1, range: 0, blankrows: false })[0] || []
const headerMap = {}
for (const h of headerRow) headerMap[normalizeKey(h)] = h
if (DEBUG) {
  console.log('Cabeçalhos detectados (normalizado -> original):')
  console.log(headerMap)
}

// Encontra chave de TON/HR e TONELAGEM por "fuzzy"
const possibleTonPerHour = Object.keys(headerMap).find(k =>
  /(^|[^A-Z])TON\/?HR([^A-Z]|$)|(^|[^A-Z])T\/?H([^A-Z]|$)|TONELADAS POR HORA|TON POR HORA/.test(k)
)
const tonKeysPriority = [
  'QTD TON','QTD T','QTD (TON)','TONELADAS','TONELADA','TON','QTD_TON','QTDTON','QTD (T)','PRODUCAO T',
  'PRODUCAO (T)','PRODUCAO TON','TOTAL TON','TOTAL (T)'
].map(normalizeKey)

// fallback “fuzzy”: qualquer coisa com QTD.*TON ou TONELAD
function findTonnageKey(obj){
  // 1) nomes conhecidos em ordem
  for (const nk of tonKeysPriority) if (nk in obj) return nk
  // 2) fuzzy
  const keys = Object.keys(obj)
  const cand = keys.find(k => /QTD.*TON|TONELAD|PRODUCAO.*T/.test(k))
  return cand || null
}

/* ---------- Conversão ---------- */
let usedTonKey = null
let computedFromTonHr = 0
let semTonnage = 0
const out = []

for (const r of rows) {
  // normaliza objeto da linha
  const obj = {}
  for (const k of Object.keys(r)) obj[normalizeKey(k)] = r[k]

  const date = toDateStr(obj['DATA INICIO']) || toDateStr(obj['DATA FIM'])
  if (!date) continue

  const start = toHHMM(obj['INICIO'])
  const end   = toHHMM(obj['FIM'])
  const hTrab = timeToHours(obj['HORAS DE TRABALHO'])
  const hProd = timeToHours(obj['HORAS DE PRODUCAO']) ?? timeToHours(obj['HORAS DE PRODUÇÃO'])

  let downtimeMin = timeToMinutes(obj['PARADAS MINUTOS'])
  if (downtimeMin == null && hTrab != null && hProd != null) {
    downtimeMin = Math.max(Math.round((hTrab - hProd) * 60), 0)
  }

  const stage = mapStage(obj['GRUPO'])
  const equipment = String(r[headerMap['EQUIPAMENTO']] ?? '').toString().trim().toUpperCase()
  const shift = mapShift(obj['TURNO'])
  const motivo = (r[headerMap['MOTIVO']] ?? '')?.toString().trim() || null

  // TONELAGEM
  let tonKey = usedTonKey || findTonnageKey(obj)
  let tonnage = null
  if (tonKey && obj[tonKey] != null) {
    tonnage = parseNumberBR(obj[tonKey])
    if (!usedTonKey) usedTonKey = tonKey
  }
  // se não encontrou ou veio vazio, tenta TON/HR * horas
  if (tonnage == null) {
    let tonHr = null
    if (possibleTonPerHour && obj[possibleTonPerHour] != null) {
      tonHr = parseNumberBR(obj[possibleTonPerHour])
    } else {
      // alguns nomes alternativos
      const altTonHrKey = Object.keys(obj).find(k => /TON\/?HR|T\/?H|TON POR HORA|TONELADAS POR HORA/.test(k))
      if (altTonHrKey) tonHr = parseNumberBR(obj[altTonHrKey])
    }
    const baseHours = (hProd != null ? hProd : hTrab)
    if (tonHr != null && baseHours != null) {
      tonnage = +(tonHr * baseHours).toFixed(2)
      computedFromTonHr++
    }
  }
  if (tonnage == null) semTonnage++

  // métricas derivadas
  const opHours = (hProd != null) ? hProd : ((hTrab != null && downtimeMin != null) ? (hTrab - downtimeMin/60) : null)
  const tph = (tonnage != null && hTrab > 0) ? +(tonnage/hTrab).toFixed(2) : null
  const tph_operational = (tonnage != null && opHours > 0) ? +(tonnage/opHours).toFixed(2) : null

  out.push({
    id: 'imp_' + uuidv4().replace(/-/g,'').slice(0,12),
    user_id: null,
    group_id: null,
    date,
    start,
    end,
    shift,
    stage,
    equipment: equipment || null,
    tonnage,
    moisture: null,
    operator: null,
    notes: motivo,
    hours: hTrab,
    tph,
    downtime_min: downtimeMin,
    downtime_cause: motivo,
    op_hours: opHours,
    tph_operational,
    tph_target: null,
    tph_delta: null,
    grade: null,
    stops_json: []
  })
}

/* ---------- Saída ---------- */
fs.writeFileSync('import_prado_entries.json', JSON.stringify(out, null, 2), 'utf8')
console.log(`OK! Gerado import_prado_entries.json com ${out.length} lançamentos.`)
console.log(`Coluna de tonelagem usada: ${usedTonKey || '(nenhuma – pode ter sido calculado por TON/HR × horas)'}`)
console.log(`Ton calculada a partir de TON/HR × horas: ${computedFromTonHr}`)
console.log(`Linhas sem tonelagem: ${semTonnage}`)
if (process.argv.includes('--debug')) {
  console.log('Dica: rodei em modo DEBUG — confira os cabeçalhos normalizados acima.')
}
