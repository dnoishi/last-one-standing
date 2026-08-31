import { CreateRunForm } from '../../components/CreateRunForm';

export default function OwnerPage() {
  return (
    <section className="mx-auto max-w-3xl">
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-orange-500">Contract owner</p>
      <h1 className="mt-2 text-4xl font-black">Create a run</h1>
      <p className="mt-3 mb-8 max-w-2xl leading-relaxed text-neutral-400">
        Choose a live dreamDEX series and publish the bracket rules on-chain. Players can register immediately after the transaction confirms.
      </p>
      <CreateRunForm />
    </section>
  );
}
