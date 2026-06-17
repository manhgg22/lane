import { STAGES } from "@harness/types";

const ICONS: Record<string, string> = {
  intake: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9z"/>',
  implement: '<path d="M5 19l9-9"/><path d="M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>',
  gates: '<path d="M5 19l3-1L19 7l-2-2L6 16z"/>',
  PR: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M5 8l7 5 7-5"/>',
  integrate: '<path d="M9 5a2 2 0 014 0h3v3a2 2 0 010 4v3h-3a2 2 0 01-4 0H6v-3a2 2 0 010-4V5z"/>',
  "e2e+QC": '<circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/>',
  review: '<circle cx="7" cy="14" r="3.5"/><circle cx="17" cy="14" r="3.5"/><path d="M9 6l1 8M15 6l-1 8M11 14h2"/>',
  "er gate": '<path d="M5 20V6M19 20V6M5 8h14M5 13h14"/>',
  "push-dev": '<path d="M12 3c3 2 4 6 3 10l-3 3-3-3c-1-4 0-8 3-10z"/><path d="M9 18l-2 3M15 18l2 3"/>',
  "dev/QC": '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>',
  "watch PR": '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
  done: '<path d="M5 12l5 5L19 7"/>',
};

export function PipelineSVG({ currentStage }: { currentStage: number }) {
  const n = STAGES.length;
  const W = 1240;
  const L = 70;
  const R = 70;
  const usable = W - L - R;
  const gap = usable / (n - 1);
  const Y = 150;
  const RAD = 17;
  const X = (i: number) => L + i * gap;

  return (
    <div className="overflow-x-auto -mx-1 my-0.5">
      <svg viewBox={`0 0 ${W} 240`} xmlns="http://www.w3.org/2000/svg" className="block min-w-[1180px]">
        {Array.from({ length: n - 1 }).map((_, i) => {
          const done = i < currentStage;
          return (
            <line
              key={`line-${i}`}
              x1={X(i) + RAD}
              y1={Y}
              x2={X(i + 1) - RAD}
              y2={Y}
              stroke={done ? "#2f9b5e" : "#26303f"}
              strokeWidth={done ? 2.4 : 2}
            />
          );
        })}
        {STAGES.map((stage, i) => {
          const isDone = i < currentStage;
          const isCurrent = i === currentStage;
          const ring = isDone ? "#34d27b" : isCurrent ? "#ec4d7e" : "#3a4659";
          const fill = isDone ? "#0f2418" : isCurrent ? "#2a1019" : "#0d121b";
          const icol = isDone ? "#5fe39a" : isCurrent ? "#ff8fae" : "#5b6678";

          return (
            <g key={stage}>
              {isCurrent && (
                <circle cx={X(i)} cy={Y} r={RAD + 4} fill="none" stroke="#ec4d7e" strokeWidth={1.4} opacity={0.5}>
                  <animate attributeName="r" values={`${RAD + 3};${RAD + 7};${RAD + 3}`} dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values=".5;0;.5" dur="1.8s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={X(i)} cy={Y} r={RAD} fill={fill} stroke={ring} strokeWidth={2.4} />
              <g
                transform={`translate(${X(i) - 7},${Y - 7}) scale(0.58)`}
                fill="none"
                stroke={icol}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dangerouslySetInnerHTML={{ __html: ICONS[stage] ?? "" }}
              />
              <text x={X(i)} y={Y + RAD + 16} textAnchor="middle" fill="#9aa5b6" fontSize={11}>
                {stage}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
