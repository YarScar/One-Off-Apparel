// Pure math for the order-time estimator.
// Every function returns each component of its equation with values substituted,
// so the UI can render the same breakdown the skill's output format specifies.

export type PrintClass = 'Thin' | 'Poly' | 'Bulky';

export interface Component {
  label: string;
  formula: string;
  minutes: number;
}

export interface OpEstimate {
  title: string;
  components: Component[];
  subtotalMinutes: number;
  notes: string[];
}

export interface ScenarioTotal {
  klass: PrintClass;
  hours: number;
}

export interface Estimate {
  primary: OpEstimate[]; // rendered breakdown (uses primaryClass for any Unknown)
  primaryClass: PrintClass;
  scenarios: ScenarioTotal[] | null; // null when class is fully determined
  totalHours: number; // total under primaryClass
  ambiguous: boolean;
}

// ---------- Screen print ----------

interface ScreenRate {
  initial: number;
  perHour: number;
}

function screenRate(screens: number, klass: PrintClass): ScreenRate {
  const smallRun = screens <= 4;
  if (klass === 'Thin') return smallRun ? { initial: 100, perHour: 360 } : { initial: 100, perHour: 180 };
  if (klass === 'Poly') return smallRun ? { initial: 80, perHour: 288 } : { initial: 80, perHour: 144 };
  return smallRun ? { initial: 50, perHour: 180 } : { initial: 50, perHour: 90 };
}

export function screenPrint(
  Z: number,
  X: number,
  klass: PrintClass,
  position: string,
): OpEstimate {
  const Y = X + 1;
  const rate = screenRate(Y, klass);
  const screenSetup = Y * 5;
  const inkSetup = X * 15;
  const initialSetup = 30;
  const initialConfig = 30;
  const remainingUnits = Math.max(0, Z - rate.initial);
  const remainingPrint = remainingUnits * (60 / rate.perHour);

  const components: Component[] = [
    {
      label: `Screen setup (Y = X+1 = ${String(Y)})`,
      formula: `${String(Y)} × 5`,
      minutes: screenSetup,
    },
    {
      label: `Ink setup (X = ${String(X)})`,
      formula: `${String(X)} × 15`,
      minutes: inkSetup,
    },
    { label: 'Initial setup', formula: '30', minutes: initialSetup },
    { label: 'Initial config', formula: '30', minutes: initialConfig },
    {
      label: `Remaining print (Z = ${String(Z)}, init ${String(rate.initial)}, ${String(rate.perHour)}/hr)`,
      formula: `max(0, ${String(Z)} − ${String(rate.initial)}) × (60/${String(rate.perHour)})`,
      minutes: remainingPrint,
    },
  ];
  const subtotal = components.reduce((s, c) => s + c.minutes, 0);
  return {
    title: `Screen Print — ${position || 'unspecified'} · ${String(X)} color(s) · ${klass}`,
    components,
    subtotalMinutes: subtotal,
    notes: [],
  };
}

// ---------- Embroidery (Flat only for now) ----------

export function embroideryFlat(
  Z: number,
  X: number,
  Y: number,
  klass: PrintClass,
  position: string,
  steaming: boolean,
): OpEstimate {
  const setupPerHour = klass === 'Thin' ? 240 : klass === 'Poly' ? 180 : 120;
  const hoopingMultiplier = klass === 'Poly' ? 2 : 1.5;
  const cleanupMultiplier = klass === 'Poly' ? 6 : 4;

  const setup = Z * (60 / setupPerHour);
  const thread = Y * 5;
  const cycles = Z / 6;
  const hooping = cycles * hoopingMultiplier;
  const loadUnload = cycles * 2;
  const cleanup = cycles * cleanupMultiplier;
  const sew = cycles * (X / 850);
  const steam = steaming ? Z * (60 / 360) : 0;

  const components: Component[] = [
    {
      label: `Setup/Boxing (${String(setupPerHour)}/hr for ${klass})`,
      formula: `${String(Z)} × (60/${String(setupPerHour)})`,
      minutes: setup,
    },
    {
      label: `Thread change (Y = ${String(Y)})`,
      formula: `${String(Y)} × 5`,
      minutes: thread,
    },
    {
      label: `Hooping (${String(hoopingMultiplier)} min per 6-unit cycle)`,
      formula: `(${String(Z)}/6) × ${String(hoopingMultiplier)}`,
      minutes: hooping,
    },
    {
      label: 'Load/Unload/Unhoop',
      formula: `(${String(Z)}/6) × 2`,
      minutes: loadUnload,
    },
    {
      label: `Cleanup (${String(cleanupMultiplier)} min per cycle)`,
      formula: `(${String(Z)}/6) × ${String(cleanupMultiplier)}`,
      minutes: cleanup,
    },
    {
      label: `Sew time (X = ${String(X)} stitches @ 850/min)`,
      formula: `(${String(Z)}/6) × (${String(X)}/850)`,
      minutes: sew,
    },
  ];
  if (steaming) {
    components.push({
      label: 'Steaming (dark/pigment garment)',
      formula: `${String(Z)} × (60/360)`,
      minutes: steam,
    });
  }
  const subtotal = components.reduce((s, c) => s + c.minutes, 0);
  return {
    title: `Embroidery — ${position || 'unspecified'} · ${String(X)} stitches · ${klass}`,
    components,
    subtotalMinutes: subtotal,
    notes: [],
  };
}

// ---------- Finishing ----------

export type FinishingKind =
  | 'printed_relabel'
  | 'fold_and_bag'
  | 'matte_finish_flat'
  | 'matte_finish_specialty'
  | 'hang_tags'
  | 'woven_label';

export function finishing(
  kind: FinishingKind,
  Z: number,
  klass: PrintClass,
  label: string,
): OpEstimate {
  let rate = 0; // units per hour
  let title = label;
  switch (kind) {
    case 'printed_relabel':
      rate = klass === 'Bulky' ? 72 : 144;
      title = `Printed Relabel · ${klass}`;
      break;
    case 'fold_and_bag':
      rate = klass === 'Thin' ? 300 : 100; // treat Thin as SS Tee heuristic
      title = `Fold & Bag · ${klass === 'Thin' ? 'SS Tee rate' : 'Other'}`;
      break;
    case 'matte_finish_flat':
      rate = klass === 'Bulky' ? 100 : 200;
      title = `Matte Finish (Flat) · ${klass}`;
      break;
    case 'matte_finish_specialty':
      rate = 60; // 1 min per unit
      title = 'Matte Finish (Specialty surface)';
      break;
    case 'hang_tags':
      rate = klass === 'Bulky' ? 150 : 300;
      title = `Hang Tags · ${klass}`;
      break;
    case 'woven_label':
      rate = 90;
      title = 'Woven Label Install';
      break;
  }
  const minutes = Z * (60 / rate);
  return {
    title,
    components: [
      {
        label: `${String(rate)} units/hr`,
        formula: `${String(Z)} × (60/${String(rate)})`,
        minutes,
      },
    ],
    subtotalMinutes: minutes,
    notes: [],
  };
}

export function detectFinishingKind(text: string): FinishingKind | null {
  const t = text.toLowerCase();
  if (t.includes('woven')) return 'woven_label';
  if (t.includes('relabel')) return 'printed_relabel';
  if (t.includes('fold')) return 'fold_and_bag';
  if (t.includes('matte')) return t.includes('specialty') ? 'matte_finish_specialty' : 'matte_finish_flat';
  if (t.includes('hang')) return 'hang_tags';
  return null;
}
