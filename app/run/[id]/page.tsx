import { notFound } from 'next/navigation';
import { RunView } from '../../../components/RunView';

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId) || runId < 1) notFound();
  return <RunView runId={runId} />;
}
