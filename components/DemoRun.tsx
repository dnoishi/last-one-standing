'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  demoParticipants,
  demoPhases,
  demoRun,
  type DemoSide,
} from '../lib/demo-data';

export function DemoRun() {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const phase = demoPhases[phaseIndex];

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      if (elapsed + 1 < phase.duration) {
        setElapsed(elapsed + 1);
        return;
      }
      setPhaseIndex((index) => (index + 1) % demoPhases.length);
      setElapsed(0);
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [elapsed, phase.duration, playing]);

  const results = useMemo(
    () => demoPhases.slice(0, phaseIndex + 1).flatMap((item) => item.result ? [item.result] : []),
    [phaseIndex],
  );
  const eliminated = useMemo(
    () => new Set(results.flatMap((result) => result.eliminated)),
    [results],
  );
  const survivors = demoParticipants.length - eliminated.size;
  const secondsRemaining = phase.duration - elapsed;
  const overallProgress = ((phaseIndex + elapsed / phase.duration) / demoPhases.length) * 100;

  function replay() {
    setPhaseIndex(0);
    setElapsed(0);
    setPlaying(true);
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-4 text-sm text-sky-100">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="font-bold uppercase tracking-widest text-sky-300">Guided sample</span>
            <p className="mt-1 text-sky-100/75">This run uses local sample data. No wallet, funds, transactions, or network connection are required.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPlaying((current) => !current)}
              className="rounded-full border border-sky-300/30 px-4 py-2 font-semibold hover:bg-sky-300/10"
            >
              {playing ? 'Pause' : 'Continue'}
            </button>
            <button onClick={replay} className="rounded-full bg-sky-300 px-4 py-2 font-bold text-sky-950 hover:bg-sky-200">
              Replay
            </button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-neutral-800 bg-gradient-to-br from-neutral-900 to-neutral-950 p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-400">Sample run #{demoRun.runId}</span>
            <h1 className="mt-2 text-4xl font-black">{demoRun.asset} · {demoRun.intervalMinutes} minute</h1>
            <p className="mt-2 text-neutral-400">Round {phase.roundNumber}/{demoRun.maxRounds} · target {demoRun.targetSurvivors} survivor</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center">
            <Stat value={survivors.toString()} label="standing" accent />
            <Stat value={`${demoRun.prizePool}`} label="tUSDC pool" />
          </div>
        </div>

        <div className="mt-7">
          <div className="mb-2 flex items-center justify-between gap-4">
            <div>
              <p className="font-black uppercase tracking-wide">{phase.title}</p>
              <p className="mt-1 text-sm text-neutral-400">{phase.detail}</p>
            </div>
            <span className="shrink-0 font-mono text-xl font-bold text-orange-300">0:{secondsRemaining.toString().padStart(2, '0')}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
            <div className="h-full bg-orange-500 transition-[width] duration-500" style={{ width: `${overallProgress}%` }} />
          </div>
        </div>

        {phase.result?.commentary && (
          <blockquote className="mt-6 border-l-2 border-orange-500 pl-4 italic text-neutral-300">“{phase.result.commentary}”</blockquote>
        )}
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">The field</p>
            <h2 className="mt-1 text-2xl font-black">Participants</h2>
          </div>
          <div className="flex gap-3 text-xs text-neutral-500">
            <span><b className="text-emerald-400">UP</b> bullish</span>
            <span><b className="text-rose-400">DOWN</b> bearish</span>
            <span><b>—</b> no call</span>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {demoParticipants.map((participant) => {
            const isOut = eliminated.has(participant.id);
            const side = phase.attempt ? participant.positions[phase.attempt] : undefined;
            return (
              <article
                key={participant.id}
                className={`rounded-xl border p-4 transition-opacity ${isOut ? 'border-neutral-800 bg-neutral-900/40 opacity-45' : 'border-emerald-500/30 bg-emerald-500/5'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold">{participant.name}</h3>
                    <p className="mt-1 font-mono text-xs text-neutral-500">{participant.address}</p>
                  </div>
                  <Position side={isOut ? undefined : side} />
                </div>
                <p className={`mt-4 text-xs font-bold uppercase tracking-widest ${isOut ? 'text-neutral-600' : 'text-emerald-400'}`}>
                  {isOut ? 'Eliminated' : phase.kind === 'finalized' ? 'Winner' : 'Standing'}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section>
        <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">On-chain outcome preview</p>
        <h2 className="mt-1 text-2xl font-black">Round feed</h2>
        {results.length === 0 ? (
          <p className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-500">Results appear here as markets settle.</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {[...results].reverse().map((result) => (
              <li key={result.attempt} className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold">{result.label}</span>
                  <span className={`text-xs font-bold uppercase ${result.voided ? 'text-amber-400' : result.winningSide === 'up' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {result.voided ? 'Voided' : `${result.winningSide} won`}
                  </span>
                </div>
                <p className="mt-2 text-sm text-neutral-400">{result.eliminated.length} eliminated · {result.survivorsRemaining} standing</p>
                <p className="mt-2 text-sm italic text-neutral-300">“{result.commentary}”</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Stat({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="min-w-28 rounded-2xl bg-black/40 px-4 py-3">
      <div className={`text-2xl font-black ${accent ? 'text-orange-400' : 'text-white'}`}>{value}</div>
      <div className="text-xs uppercase tracking-widest text-neutral-500">{label}</div>
    </div>
  );
}

function Position({ side }: { side?: DemoSide }) {
  if (!side || side === 'none') return <span className="font-mono text-xs text-neutral-600">—</span>;
  return <span className={`text-xs font-black uppercase ${side === 'up' ? 'text-emerald-400' : 'text-rose-400'}`}>{side}</span>;
}
