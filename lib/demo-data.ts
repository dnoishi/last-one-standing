export type DemoSide = 'up' | 'down' | 'none';
export type DemoPhaseKind = 'registration' | 'live' | 'settled' | 'voided' | 'finalized';

export interface DemoParticipant {
  id: string;
  name: string;
  address: string;
  positions: Record<string, DemoSide>;
}

export interface DemoResult {
  attempt: string;
  label: string;
  winningSide?: Exclude<DemoSide, 'none'>;
  eliminated: string[];
  survivorsRemaining: number;
  commentary: string;
  voided?: boolean;
}

export interface DemoPhase {
  kind: DemoPhaseKind;
  duration: number;
  attempt?: string;
  roundNumber: number;
  title: string;
  detail: string;
  result?: DemoResult;
}

export const demoRun = {
  runId: 42,
  asset: 'BTC/USD',
  intervalMinutes: 15,
  maxRounds: 3,
  targetSurvivors: 1,
  entryStake: 5,
  prizePool: 40,
};

export const demoParticipants: DemoParticipant[] = [
  { id: 'maya', name: 'Maya', address: '0x8A31…7C4F', positions: { r1: 'up', r2v: 'down', r2: 'up', r3: 'none' } },
  { id: 'leo', name: 'Leo', address: '0x19D2…A811', positions: { r1: 'up', r2v: 'up', r2: 'down', r3: 'down' } },
  { id: 'nia', name: 'Nia', address: '0xC405…2E90', positions: { r1: 'down', r2v: 'none', r2: 'none', r3: 'none' } },
  { id: 'omar', name: 'Omar', address: '0x72B8…0D13', positions: { r1: 'up', r2v: 'down', r2: 'down', r3: 'none' } },
  { id: 'sora', name: 'Sora', address: '0xE61A…9B25', positions: { r1: 'up', r2v: 'up', r2: 'up', r3: 'none' } },
  { id: 'theo', name: 'Theo', address: '0x33F0…61AA', positions: { r1: 'down', r2v: 'none', r2: 'none', r3: 'none' } },
  { id: 'zuri', name: 'Zuri', address: '0xB927…4F08', positions: { r1: 'up', r2v: 'down', r2: 'down', r3: 'up' } },
  { id: 'ivan', name: 'Ivan', address: '0x5D44…C712', positions: { r1: 'none', r2v: 'none', r2: 'none', r3: 'none' } },
];

export const demoPhases: DemoPhase[] = [
  {
    kind: 'registration',
    duration: 6,
    roundNumber: 0,
    title: 'Registration open',
    detail: 'Eight players deposit 5 tUSDC each. The entries form the winner pool.',
  },
  {
    kind: 'live',
    duration: 9,
    attempt: 'r1',
    roundNumber: 1,
    title: 'Round 1 is live',
    detail: 'Players take an Up or Down position before the BTC market locks.',
  },
  {
    kind: 'settled',
    duration: 5,
    attempt: 'r1',
    roundNumber: 1,
    title: 'Up wins round 1',
    detail: 'Down positions and missing calls are eliminated automatically.',
    result: {
      attempt: 'r1',
      label: 'Round 1',
      winningSide: 'up',
      eliminated: ['nia', 'theo', 'ivan'],
      survivorsRemaining: 5,
      commentary: 'The opening bell takes three. Five players keep their footing.',
    },
  },
  {
    kind: 'live',
    duration: 8,
    attempt: 'r2v',
    roundNumber: 2,
    title: 'Round 2 is live',
    detail: 'The next scheduled market is armed and every survivor calls again.',
  },
  {
    kind: 'voided',
    duration: 5,
    attempt: 'r2v',
    roundNumber: 2,
    title: 'Round 2 is voided',
    detail: 'The market did not resolve cleanly, so nobody is eliminated.',
    result: {
      attempt: 'r2v',
      label: 'Round 2 attempt',
      eliminated: [],
      survivorsRemaining: 5,
      commentary: 'No decision, no casualties. The field resets for another market.',
      voided: true,
    },
  },
  {
    kind: 'live',
    duration: 8,
    attempt: 'r2',
    roundNumber: 2,
    title: 'Round 2 retries',
    detail: 'A fresh market replaces the voided attempt; surviving players reposition.',
  },
  {
    kind: 'settled',
    duration: 5,
    attempt: 'r2',
    roundNumber: 2,
    title: 'Down wins round 2',
    detail: 'Two Up callers leave the bracket. Three players remain.',
    result: {
      attempt: 'r2',
      label: 'Round 2',
      winningSide: 'down',
      eliminated: ['maya', 'sora'],
      survivorsRemaining: 3,
      commentary: 'The drop cuts the field to three. One last call separates them.',
    },
  },
  {
    kind: 'live',
    duration: 8,
    attempt: 'r3',
    roundNumber: 3,
    title: 'Final round is live',
    detail: 'Leo, Omar, and Zuri make their final call for the entire pool.',
  },
  {
    kind: 'finalized',
    duration: 9,
    attempt: 'r3',
    roundNumber: 3,
    title: 'Zuri is last one standing',
    detail: 'Up wins. Zuri is the sole survivor and can claim the 40 tUSDC pool.',
    result: {
      attempt: 'r3',
      label: 'Round 3',
      winningSide: 'up',
      eliminated: ['leo', 'omar'],
      survivorsRemaining: 1,
      commentary: 'Zuri stands alone after three rounds and takes the full prize.',
    },
  },
];
