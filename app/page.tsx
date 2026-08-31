import { RunsList } from '../components/RunsList';

export default function HomePage() {
  return (
    <div className="space-y-16">
      <section className="max-w-4xl py-12">
        <p className="text-sm font-bold uppercase tracking-[0.35em] text-orange-500">Live prediction knockout</p>
        <h1 className="mt-5 text-6xl font-black leading-[0.95] tracking-tight sm:text-8xl">CALL IT RIGHT.<br />STAY ALIVE.</h1>
        <p className="mt-7 max-w-2xl text-lg leading-relaxed text-neutral-400">Enter a scheduled run. Hold a real Up or Down position on dreamDEX each round. One wrong call—or no call—and you’re out.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="/demo" className="inline-block rounded-full bg-orange-500 px-6 py-3 font-black text-black hover:bg-orange-400">Watch the demo</a>
          <a href="#runs" className="inline-block rounded-full border border-neutral-700 px-6 py-3 font-black text-white hover:border-neutral-500">Find a live run</a>
        </div>
      </section>

      <section id="runs">
        <div className="mb-5 flex items-end justify-between">
          <div><p className="text-xs font-bold uppercase tracking-widest text-neutral-500">The arena</p><h2 className="mt-1 text-3xl font-black">Latest runs</h2></div>
          <a href="/runs" className="text-sm text-orange-400 hover:text-orange-300">View all →</a>
        </div>
        <RunsList limit={4} />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Rule number="01" title="Enter" text="Register before the run starts. Your entry stake funds the winner pool." />
        <Rule number="02" title="Call" text="Buy enough real Up or Down contracts before every market locks." />
        <Rule number="03" title="Survive" text="Wrong or absent calls are eliminated. At max rounds, everyone left splits." />
      </section>

      <section className="rounded-3xl border border-neutral-800 bg-neutral-900/50 p-7">
        <h2 className="text-2xl font-black">Fair by construction</h2>
        <ul className="mt-4 grid gap-3 text-sm text-neutral-400 md:grid-cols-2">
          <li>Voided market? Nobody is eliminated and the round does not count.</li>
          <li>Complete wipeout? The players alive at the round’s start split the pool.</li>
          <li>Resolution and elimination execute on-chain through Somnia Reactivity.</li>
          <li>AI commentary is optional and can never block bracket settlement.</li>
        </ul>
      </section>
    </div>
  );
}

function Rule({ number, title, text }: { number: string; title: string; text: string }) {
  return <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5"><span className="font-mono text-orange-500">{number}</span><h3 className="mt-4 text-xl font-black uppercase">{title}</h3><p className="mt-2 text-sm leading-relaxed text-neutral-400">{text}</p></div>;
}
