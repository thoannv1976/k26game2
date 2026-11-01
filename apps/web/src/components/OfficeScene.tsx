import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export type OfficeSpot = 'board' | 'documents' | 'interviews' | 'report' | 'academy';

function Hotspot({ id, label, onSelect, children, labelPos }: { id: OfficeSpot; label: string; onSelect: (s: OfficeSpot) => void; children: ReactNode; labelPos: [number, number] }) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(id);
    }
  };
  return (
    <g className="office-hotspot" role="button" tabIndex={0} aria-label={label} data-spot={id} onClick={() => onSelect(id)} onKeyDown={onKey}>
      {children}
      <g className="hidden sm:block" transform={`translate(${labelPos[0]} ${labelPos[1]})`}>
        <rect x={-label.length * 3.6 - 12} y="-15" width={label.length * 7.2 + 24} height="26" rx="13" fill="var(--ed-surface)" stroke="var(--ed-line)" />
        <text x="0" y="3" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--ed-fg)">
          {label}
        </text>
        <rect className="hotspot-ring" x={-label.length * 3.6 - 15} y="-18" width={label.length * 7.2 + 30} height="32" rx="16" fill="none" stroke="var(--ed-primary)" strokeWidth="3" />
      </g>
    </g>
  );
}

/** Illustrated 2.5D detective office (code-drawn SVG) with clickable, keyboard-accessible hotspots. */
export function OfficeScene({ onSelect }: { onSelect: (s: OfficeSpot) => void }) {
  const { t } = useTranslation();
  const short = (k: OfficeSpot) => t(`office.hotspots.${k}`).split(' – ')[0]!;
  return (
    <svg viewBox="0 0 1000 520" className="block h-auto w-full" role="group" aria-label={t('office.sceneLabel')}>
      <defs>
        <linearGradient id="of-wall" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--ed-wall)" />
          <stop offset="1" stopColor="var(--ed-wall-2)" />
        </linearGradient>
        <radialGradient id="of-lamp" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffe9a8" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffe9a8" stopOpacity="0" />
        </radialGradient>
        <pattern id="of-planks" width="120" height="30" patternUnits="userSpaceOnUse">
          <rect width="120" height="30" fill="var(--ed-floor)" />
          <path d="M0 29.5h120M60 0v30" stroke="var(--ed-wood-2)" strokeOpacity="0.35" />
        </pattern>
      </defs>

      {/* room */}
      <rect x="140" y="0" width="720" height="340" fill="url(#of-wall)" />
      <rect x="140" y="300" width="720" height="40" fill="var(--ed-wall-2)" />
      <path d="M140 300h720" stroke="var(--ed-wood)" strokeWidth="4" />
      <polygon points="0,0 140,0 140,340 0,430" fill="var(--ed-wall-2)" />
      <polygon points="860,0 1000,0 1000,430 860,340" fill="var(--ed-wall-2)" />
      <polygon points="0,430 140,340 860,340 1000,430 1000,520 0,520" fill="url(#of-planks)" />
      <path d="M140 340 0 430M860 340l140 90" stroke="var(--ed-wood-2)" strokeOpacity="0.5" strokeWidth="2" />

      {/* window with blinds */}
      <g>
        <rect x="590" y="48" width="150" height="150" rx="4" fill="#1f3550" />
        <circle cx="700" cy="88" r="14" fill="#fdf3c4" opacity="0.85" />
        {Array.from({ length: 9 }, (_, i) => (
          <rect key={i} x="592" y={52 + i * 16} width="146" height="7" fill="var(--ed-surface-2)" opacity="0.85" />
        ))}
        <rect x="585" y="44" width="160" height="158" rx="6" fill="none" stroke="var(--ed-wood)" strokeWidth="8" />
      </g>

      {/* clock */}
      <g transform="translate(800 70)">
        <circle r="26" fill="var(--ed-paper)" stroke="var(--ed-wood)" strokeWidth="5" />
        <path d="M0 0V-16M0 0l11 6" stroke="var(--ed-fg)" strokeWidth="3" strokeLinecap="round" />
      </g>

      {/* CASE BOARD */}
      <Hotspot id="board" label={short('board')} onSelect={onSelect} labelPos={[375, 255]}>
        <rect x="222" y="42" width="306" height="196" rx="6" fill="var(--ed-wood)" />
        <rect x="232" y="52" width="286" height="176" rx="3" fill="var(--ed-cork)" />
        {[
          [252, 66, -4, 'var(--ed-paper)'],
          [330, 72, 3, '#fdf3c4'],
          [418, 64, -2, 'var(--ed-paper)'],
          [262, 146, 4, '#e3e8ef'],
          [360, 150, -3, 'var(--ed-paper)'],
          [446, 140, 5, '#f8dcd6'],
        ].map(([x, y, r, fill], i) => (
          <g key={i} transform={`rotate(${r} ${Number(x) + 30} ${Number(y) + 28})`}>
            <rect x={x} y={y} width="62" height="56" fill={String(fill)} stroke="rgb(0 0 0 / 0.12)" />
            <path d={`M${Number(x) + 8} ${Number(y) + 18}h40M${Number(x) + 8} ${Number(y) + 28}h46M${Number(x) + 8} ${Number(y) + 38}h30`} stroke="var(--ed-muted)" strokeOpacity="0.6" strokeWidth="2" />
          </g>
        ))}
        <rect x="378" y="96" width="44" height="54" fill="#cfd8e3" stroke="#fff" strokeWidth="3" transform="rotate(-2 400 123)" />
        <circle cx="400" cy="116" r="9" fill="#5d5f68" />
        <path d="M386 146c3-14 25-14 28 0" fill="#5d5f68" />
        <g stroke="var(--ed-string)" strokeWidth="2.2" fill="none">
          <path d="M282 70 362 76 450 68" />
          <path d="M362 76 400 100 292 150" />
          <path d="M400 100 476 144" />
          <path d="M450 68 392 154" />
        </g>
        {[
          [282, 70],
          [362, 76],
          [450, 68],
          [292, 150],
          [392, 154],
          [476, 144],
          [400, 100],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="5" fill="var(--ed-string)" stroke="#7b1d14" strokeWidth="1" />
        ))}
      </Hotspot>

      {/* INTERVIEW ROOM DOOR (left wall) */}
      <Hotspot id="interviews" label={short('interviews')} onSelect={onSelect} labelPos={[72, 92]}>
        <polygon points="26,128 116,108 116,346 26,398" fill="var(--ed-wood)" />
        <polygon points="34,134 108,118 108,340 34,390" fill="var(--ed-wood-2)" />
        <polygon points="44,150 98,138 98,214 44,230" fill="#cfe0ee" opacity="0.85" />
        <text x="71" y="190" textAnchor="middle" fontSize="11" fontWeight="800" fill="#1f3550" transform="skewY(-12) translate(0 15)">
          INTERVIEW
        </text>
        <circle cx="96" cy="270" r="5" fill="var(--ed-manila)" />
      </Hotspot>

      {/* TROPHY SHELF (right wall) */}
      <Hotspot id="academy" label={short('academy')} onSelect={onSelect} labelPos={[930, 120]}>
        <polygon points="872,200 990,236 990,248 872,212" fill="var(--ed-wood)" />
        <polygon points="872,272 990,316 990,328 872,284" fill="var(--ed-wood)" />
        <g fill="#e2b13c" stroke="#94560a" strokeWidth="1.5">
          <path d="M888 172h22v8c0 9-6 14-11 14s-11-5-11-14z" />
          <rect x="895" y="194" width="8" height="10" />
          <rect x="890" y="202" width="18" height="5" />
          <path d="M940 196h18v7c0 7-5 11-9 11s-9-4-9-11z" />
          <rect x="946" y="214" width="6" height="10" />
          <rect x="942" y="221" width="14" height="5" />
        </g>
        <g>
          <rect x="890" y="246" width="16" height="30" fill="#c0392b" />
          <rect x="908" y="250" width="12" height="30" fill="#1f3550" />
          <rect x="922" y="254" width="15" height="31" fill="#23683b" />
          <circle cx="962" cy="290" r="11" fill="#e2b13c" stroke="#94560a" strokeWidth="1.5" />
          <path d="M962 284l2 4 4 .5-3 3 .8 4-3.8-2-3.8 2 .8-4-3-3 4-.5z" fill="#fffdf7" />
        </g>
      </Hotspot>

      {/* FILING CABINET */}
      <Hotspot id="documents" label={short('documents')} onSelect={onSelect} labelPos={[800, 196]}>
        <polygon points="752,226 842,226 862,212 772,212" fill="#9aa7b6" />
        <polygon points="842,226 862,212 862,402 842,418" fill="#6d7a8a" />
        <rect x="752" y="226" width="90" height="192" fill="#8593a4" />
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect x="760" y={236 + i * 60} width="74" height="50" rx="3" fill="#97a5b5" stroke="#5f6c7b" />
            <rect x="780" y={244 + i * 60} width="34" height="12" rx="2" fill="#fffdf7" />
            <text x="797" y={254 + i * 60} textAnchor="middle" fontSize="9" fontWeight="800" fill="#1f3550">
              {['A–F', 'G–M', 'N–Z'][i]}
            </text>
            <rect x="787" y={266 + i * 60} width="20" height="6" rx="3" fill="#3d4652" />
          </g>
        ))}
        <rect x="768" y="200" width="44" height="16" fill="var(--ed-manila)" transform="rotate(-5 790 208)" />
        <rect x="776" y="194" width="44" height="16" fill="var(--ed-manila-2)" transform="rotate(4 798 202)" />
      </Hotspot>

      {/* plant */}
      <g>
        <rect x="170" y="352" width="44" height="46" rx="6" fill="#a8261d" opacity="0.85" />
        <path d="M192 352c-20-30-10-56 0-70 8 18 14 44 0 70zM192 352c-34-14-42-34-38-48 16 8 34 24 38 48zM192 352c30-16 36-36 34-50-16 8-30 26-34 50z" fill="#2f6f57" />
      </g>

      {/* DESK + TYPEWRITER (report desk) */}
      <g>
        <polygon points="300,396 700,396 748,438 252,438" fill="var(--ed-wood)" />
        <rect x="252" y="438" width="496" height="62" fill="var(--ed-wood-2)" />
        <rect x="270" y="450" width="140" height="38" rx="3" fill="var(--ed-wood)" />
        <rect x="590" y="450" width="140" height="38" rx="3" fill="var(--ed-wood)" />
        <rect x="325" y="466" width="30" height="6" rx="3" fill="var(--ed-manila)" />
        <rect x="645" y="466" width="30" height="6" rx="3" fill="var(--ed-manila)" />
        {/* lamp */}
        <ellipse className="lamp-glow" cx="330" cy="370" rx="90" ry="60" fill="url(#of-lamp)" />
        <rect x="316" y="392" width="34" height="8" rx="3" fill="#1f3550" />
        <path d="M333 392V348l26-22" stroke="#1f3550" strokeWidth="5" fill="none" />
        <path d="M344 320l40 10-14 22z" fill="#23683b" />
        {/* folder + magnifier */}
        <polygon points="604,388 676,388 690,404 618,404" fill="var(--ed-manila)" />
        <circle cx="664" cy="384" r="12" fill="#cfe0ee" stroke="#1f3550" strokeWidth="4" opacity="0.95" />
        <path d="M673 393l12 10" stroke="#1f3550" strokeWidth="5" strokeLinecap="round" />
        {/* mug with steam */}
        <rect x="560" y="370" width="22" height="26" rx="4" fill="var(--ed-paper)" stroke="var(--ed-line)" />
        <path d="M582 376c9 0 9 14 0 14" fill="none" stroke="var(--ed-line)" strokeWidth="3" />
        <path className="steam" d="M566 362c-4-6 4-8 0-14" stroke="var(--ed-muted)" strokeWidth="2" fill="none" />
        <path className="steam s2" d="M575 362c-4-6 4-8 0-14" stroke="var(--ed-muted)" strokeWidth="2" fill="none" />
      </g>
      <Hotspot id="report" label={short('report')} onSelect={onSelect} labelPos={[470, 306]}>
        <rect x="438" y="318" width="64" height="44" fill="var(--ed-paper)" stroke="var(--ed-line)" />
        <path d="M446 330h48M446 340h40M446 350h44" stroke="var(--ed-muted)" strokeOpacity="0.6" strokeWidth="2" />
        <rect x="420" y="354" width="100" height="16" rx="8" fill="#22303f" />
        <polygon points="410,368 530,368 548,398 392,398" fill="#1f3550" />
        {Array.from({ length: 3 }, (_, r) =>
          Array.from({ length: 8 }, (_, c) => <circle key={`${r}-${c}`} cx={418 + c * 15 + r * 4} cy={376 + r * 7} r="3" fill="var(--ed-paper)" />),
        )}
      </Hotspot>

      {/* chair */}
      <g>
        <rect x="455" y="470" width="90" height="50" rx="10" fill="#7b1d14" opacity="0.9" />
      </g>
    </svg>
  );
}
