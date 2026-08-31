import type { Metadata } from 'next';
import { DemoRun } from '../../components/DemoRun';

export const metadata: Metadata = {
  title: 'Guided Demo · Last One Standing',
  description: 'Watch a wallet-free sample Last One Standing run play out.',
};

export default function DemoPage() {
  return <DemoRun />;
}
