import { PAPER, INK } from "../lib/colors";

export default function GradeChip({ grade }) {
  if (!grade) return null;
  return (
    <span
      className="px-2 py-0.5 text-xs font-bold"
      style={{
        color: PAPER,
        background: INK,
        fontFamily: "'Shippori Mincho', serif",
        letterSpacing: "0.05em",
      }}
    >
      {grade}
    </span>
  );
}
