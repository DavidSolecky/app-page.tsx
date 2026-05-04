'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import QRCode from 'qrcode';
import jsPDF from 'jspdf';

type Job = { id: string; job_no: string; name: string; customer: string | null };
type Assembly = { id: string; job_id: string; assembly_no: string; name: string; note: string | null };
type Part = {
  id: string; job_id: string; assembly_id: string; qr_code: string; part_no: string; piece_no: number;
  name: string; material: string; thickness: number; note: string | null; required_final: string; status: string;
};

const statuses = ['Čaká na pálenie','Vypálené','Obrúsené','Ohnuté','Opracované','Pripravené pre zámočníkov','Problém'];
const weights: Record<string, number> = {'Čaká na pálenie':0,'Vypálené':25,'Obrúsené':50,'Ohnuté':100,'Opracované':100,'Pripravené pre zámočníkov':100,'Problém':0};
const readyStatuses = ['Ohnuté','Opracované','Pripravené pre zámočníkov'];

export default function Home() {
  const [tab, setTab] = useState<'dashboard'|'scan'|'admin'|'labels'>('dashboard');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [jobId, setJobId] = useState<string>('');
  const [scan, setScan] = useState('2026-015-RAM-001-01');
  const [message, setMessage] = useState('');
  const [newPart, setNewPart] = useState({ part_no:'', name:'', material:'S355', thickness:'10', count:'1', note:'', required_final:'Ohnuté' });
  const [newJob, setNewJob] = useState({ job_no:'', name:'' });
  const [newAssembly, setNewAssembly] = useState({ assembly_no:'', name:'' });

  async function load() {
    const [{ data: j }, { data: a }, { data: p }] = await Promise.all([
      supabase.from('jobs').select('*').order('job_no'),
      supabase.from('assemblies').select('*').order('assembly_no'),
      supabase.from('parts').select('*').order('qr_code'),
    ]);
    setJobs((j as Job[]) || []); setAssemblies((a as Assembly[]) || []); setParts((p as Part[]) || []);
    if (!jobId && j && j[0]) setJobId(j[0].id);
  }
  useEffect(() => { load(); }, []);

  const jobParts = parts.filter(p => p.job_id === jobId);
  const jobAssemblies = assemblies.filter(a => a.job_id === jobId);
  const scanned = parts.find(p => p.qr_code === scan.trim());
  const totalProgress = jobParts.length ? Math.round(jobParts.reduce((s,p)=>s+(weights[p.status] ?? 0),0)/jobParts.length) : 0;
  const ready = jobParts.length ? Math.round(jobParts.filter(p=>readyStatuses.includes(p.status)).length/jobParts.length*100) : 0;
  const burnList = useMemo(() => {
    const m = new Map<string, Part[]>();
    for (const p of jobParts) { const k = `${p.material}|${p.thickness}`; m.set(k, [...(m.get(k)||[]), p]); }
    return [...m.entries()].map(([k, list]) => ({ key:k, material:k.split('|')[0], thickness:k.split('|')[1], list })).sort((a,b)=>Number(a.thickness)-Number(b.thickness));
  }, [jobParts]);

  async function updateStatus(part: Part, status: string) {
    const { error } = await supabase.from('parts').update({ status, updated_at: new Date().toISOString() }).eq('id', part.id);
    if (!error) await supabase.from('part_events').insert({ part_id: part.id, old_status: part.status, new_status: status, note: 'Mobilné skenovanie' });
    setMessage(error ? error.message : `Uložené: ${part.qr_code} → ${status}`); await load();
  }

  async function addJob() {
    if (!newJob.job_no || !newJob.name) return;
    const { error } = await supabase.from('jobs').insert(newJob);
    setMessage(error ? error.message : 'Zákazka pridaná'); setNewJob({ job_no:'', name:'' }); await load();
  }

  async function addAssembly() {
    if (!jobId || !newAssembly.assembly_no || !newAssembly.name) return;
    const { error } = await supabase.from('assemblies').insert({ ...newAssembly, job_id: jobId });
    setMessage(error ? error.message : 'Zostava pridaná'); setNewAssembly({ assembly_no:'', name:'' }); await load();
  }

  async function addParts() {
    const assembly = jobAssemblies[0]; const job = jobs.find(j=>j.id===jobId); if (!assembly || !job) return;
    const count = Math.max(1, Number(newPart.count));
    const rows = Array.from({ length: count }, (_, i) => ({
      job_id: jobId, assembly_id: assembly.id, qr_code: `${job.job_no}-${assembly.assembly_no}-${newPart.part_no}-${String(i+1).padStart(2,'0')}`,
      part_no: newPart.part_no, piece_no: i+1, name: newPart.name, material: newPart.material, thickness: Number(newPart.thickness),
      note: newPart.note, required_final: newPart.required_final, status: 'Čaká na pálenie'
    }));
    const { error } = await supabase.from('parts').insert(rows);
    setMessage(error ? error.message : 'Výpalky pridané'); setNewPart({ part_no:'', name:'', material:'S355', thickness:'10', count:'1', note:'', required_final:'Ohnuté' }); await load();
  }

  async function printLabels() {
    const doc = new jsPDF({ unit:'mm', format:'a4' });
    let x=10, y=10;
    for (const p of jobParts) {
      const a = assemblies.find(a=>a.id===p.assembly_id); const j = jobs.find(j=>j.id===p.job_id);
      const qr = await QRCode.toDataURL(p.qr_code, { margin:1 });
      doc.rect(x,y,90,50); doc.setFontSize(12); doc.text('SOF-Track',x+3,y+6);
      doc.setFontSize(8); doc.text(`Zákazka: ${j?.job_no || ''}`,x+3,y+13); doc.text(`Zostava: ${a?.assembly_no || ''}`,x+3,y+18);
      doc.text(`Výpalok: ${p.part_no}-${String(p.piece_no).padStart(2,'0')}`,x+3,y+23); doc.text(`Hrúbka: ${p.thickness} mm`,x+3,y+28);
      doc.text(`Materiál: ${p.material}`,x+3,y+33); doc.text(`Pozn.: ${p.note || ''}`,x+3,y+38);
      doc.addImage(qr,'PNG',x+60,y+10,25,25);
      x += 95; if (x > 110) { x=10; y += 55; } if (y > 240) { doc.addPage(); x=10; y=10; }
    }
    doc.save('SOF-Track-stitky.pdf');
  }

  return <main className="min-h-screen p-4 md:p-6 bg-slate-50 text-slate-900">
    <div className="max-w-7xl mx-auto space-y-5">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div><div className="text-sm text-slate-500">SOF-Track</div><h1 className="text-3xl font-bold">Sledovanie výpalkov</h1></div>
        <nav className="flex flex-wrap gap-2">
          {(['dashboard','scan','admin','labels'] as const).map(t => <button key={t} onClick={()=>setTab(t)} className={`px-4 py-2 rounded-xl ${tab===t?'bg-slate-900 text-white':'bg-white border'}`}>{t==='dashboard'?'PC prehľad':t==='scan'?'Mobil sken':t==='admin'?'Pridávanie':'QR štítky'}</button>)}
        </nav>
      </header>
      <section className="bg-white rounded-2xl shadow p-4 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <select className="border rounded-xl px-3 py-2" value={jobId} onChange={e=>setJobId(e.target.value)}>{jobs.map(j=><option key={j.id} value={j.id}>{j.job_no} – {j.name}</option>)}</select>
        <div className="font-semibold">Rozpracovanosť: {totalProgress}% · Pripravené pre zámočníkov: {ready}%</div>
      </section>
      {message && <div className="p-3 rounded-xl bg-blue-100 text-blue-900">{message}</div>}

      {tab==='dashboard' && <div className="grid lg:grid-cols-2 gap-5">
        <Card title="Pripravenosť zostáv">
          <table className="w-full text-sm"><thead><tr className="border-b text-left"><th>Zostava</th><th>Diely</th><th>Pripravenosť</th><th>Chýba</th></tr></thead><tbody>{jobAssemblies.map(a=>{const ps=jobParts.filter(p=>p.assembly_id===a.id); const rp=ps.length?Math.round(ps.filter(p=>readyStatuses.includes(p.status)).length/ps.length*100):0; return <tr key={a.id} className="border-b"><td className="py-2">{a.assembly_no} – {a.name}</td><td>{ps.length}</td><td>{rp}%</td><td>{ps.filter(p=>!readyStatuses.includes(p.status)).length}</td></tr>})}</tbody></table>
        </Card>
        <Card title="Automatický zoznam na pálenie podľa hrúbky">
          {burnList.map(g=><div key={g.key} className="border rounded-xl p-3 mb-2"><b>{g.material} / {g.thickness} mm</b><div>{g.list.length} ks</div><div className="text-sm text-slate-500">{[...new Set(g.list.map(p=>p.part_no+' '+p.name))].join(', ')}</div></div>)}
        </Card>
        <Card title="Výpalky"><div className="max-h-96 overflow-auto">{jobParts.map(p=><div key={p.id} className="border-b py-2 flex justify-between gap-2"><span>{p.qr_code}<br/><small>{p.name} · {p.material}/{p.thickness} mm · {p.note}</small></span><b>{p.status}</b></div>)}</div></Card>
      </div>}

      {tab==='scan' && <div className="grid lg:grid-cols-2 gap-5"><Card title="Skenovanie QR"><p className="text-slate-600 mb-3">Pre test vložte QR kód. Kamera sa doplní v produkčnom režime cez html5-qrcode podľa povolení mobilu.</p><input className="w-full border rounded-xl px-3 py-3" value={scan} onChange={e=>setScan(e.target.value)} /></Card><Card title="Diel">{scanned ? <div className="space-y-3"><h2 className="text-2xl font-bold">{scanned.part_no} – {scanned.name}</h2><p>{scanned.qr_code}</p><p>{scanned.material} / {scanned.thickness} mm · Pozn.: {scanned.note}</p><p>Stav: <b>{scanned.status}</b></p><div className="grid grid-cols-2 gap-2">{statuses.slice(1).map(s=><button className="border rounded-xl px-3 py-2 hover:bg-slate-100" key={s} onClick={()=>updateStatus(scanned,s)}>{s}</button>)}</div></div> : <p>Diel sa nenašiel.</p>}</Card></div>}

      {tab==='admin' && <div className="grid lg:grid-cols-3 gap-5"><Card title="Nová zákazka"><input className="w-full border rounded-xl px-3 py-2 mb-2" placeholder="Číslo zákazky" value={newJob.job_no} onChange={e=>setNewJob({...newJob,job_no:e.target.value})}/><input className="w-full border rounded-xl px-3 py-2 mb-2" placeholder="Názov" value={newJob.name} onChange={e=>setNewJob({...newJob,name:e.target.value})}/><button className="bg-slate-900 text-white rounded-xl px-4 py-2" onClick={addJob}>Pridať</button></Card><Card title="Nová zostava"><input className="w-full border rounded-xl px-3 py-2 mb-2" placeholder="Číslo zostavy" value={newAssembly.assembly_no} onChange={e=>setNewAssembly({...newAssembly,assembly_no:e.target.value})}/><input className="w-full border rounded-xl px-3 py-2 mb-2" placeholder="Názov" value={newAssembly.name} onChange={e=>setNewAssembly({...newAssembly,name:e.target.value})}/><button className="bg-slate-900 text-white rounded-xl px-4 py-2" onClick={addAssembly}>Pridať</button></Card><Card title="Nové výpalky"><input className="w-full border rounded-xl px-3 py-2 mb-2" placeholder="Číslo výpalku" value={newPart.part_no} onChange={e=>setNewPart({...newPart,part_no:e.target.value})}/><input className="w-full border rounded-xl px-3 py-2 mb-2" placeholder="Názov" value={newPart.name} onChange={e=>setNewPart({...newPart,name:e.target.value})}/><input className="w-full border rounded-xl px-3 py-2 mb-2" placeholder="Materiál" value={newPart.material} onChange={e=>setNewPart({...newPart,material:e.target.value})}/><input className="w-full border rounded-xl px-3 py-2 mb-2" placeholder="Hrúbka" value={newPart.thickness} onChange={e=>setNewPart({...newPart,thickness:e.target.value})}/><input className="w-full border rounded-xl px-3 py-2 mb-2" placeholder="Počet" value={newPart.count} onChange={e=>setNewPart({...newPart,count:e.target.value})}/><input className="w-full border rounded-xl px-3 py-2 mb-2" placeholder="Poznámka" value={newPart.note} onChange={e=>setNewPart({...newPart,note:e.target.value})}/><button className="bg-slate-900 text-white rounded-xl px-4 py-2" onClick={addParts}>Pridať výpalky</button></Card></div>}

      {tab==='labels' && <Card title="Tlač QR štítkov"><p className="mb-3">Štítok obsahuje: číslo zákazky, číslo zostavy, číslo výpalku, hrúbku, materiál a poznámku.</p><button className="bg-slate-900 text-white rounded-xl px-4 py-2" onClick={printLabels}>Vygenerovať PDF štítky</button></Card>}
    </div>
  </main>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="bg-white rounded-2xl shadow p-4"><h2 className="text-xl font-semibold mb-3">{title}</h2>{children}</section>
}
