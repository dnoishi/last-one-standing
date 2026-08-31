import { RunsList } from '../../components/RunsList';

export default function RunsPage() {
  return (
    <section>
      <p className="text-xs font-bold uppercase tracking-widest text-orange-500">History & live field</p>
      <h1 className="mt-2 mb-8 text-4xl font-black">All runs</h1>
      <RunsList />
    </section>
  );
}
