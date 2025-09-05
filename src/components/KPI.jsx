
import React from 'react'

export default function KPI({ title, value, icon }) {
  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <div className="px-4 pt-3 text-sm text-slate-500 flex items-center gap-2">
        {icon}{title}
      </div>
      <div className="px-4 pb-4 text-2xl font-bold">{value}</div>
    </div>
  )
}
