
import React from 'react'

export default function Message({ text, onClose }){
  if(!text) return null
  return (
    <div className="fixed top-4 right-4 z-50 bg-slate-900 text-white px-4 py-2 rounded-xl shadow-lg">
      <div className="flex items-center gap-3">
        <span>{text}</span>
        <button className="text-slate-300 hover:text-white" onClick={onClose}>×</button>
      </div>
    </div>
  )
}
