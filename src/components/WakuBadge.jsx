import { WAKU_COLORS } from "../lib/colors";

export default function WakuBadge({ num, waku }) {
  const c = WAKU_COLORS[waku] || WAKU_COLORS[1];
  return (
    <div
      className="flex items-center justify-center font-bold shrink-0"
      style={{
        width: 28,
        height: 28,
        background: c.bg,
        color: c.text,
        border: `1.5px solid ${c.border}`,
        fontFamily: "'Shippori Mincho', serif",
        fontSize: 14,
      }}
    >
      {num || "-"}
    </div>
  );
}
