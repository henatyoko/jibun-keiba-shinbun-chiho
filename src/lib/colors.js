// レトロ新聞風カラートークン。jibun-keiba-shinbun(中央競馬版)と揃えている。
export const PAPER = "#FBF6E8";
export const PAPER_CARD = "#FFFDF6";
export const INK = "#3D2B1E";
export const RED = "#E2776B";
export const MUTED = "#8A7A68";
export const LINE = "#3D2B1E";
export const MINT = "#BED9C1";

// 予想印(競馬新聞の伝統的な記号)
export const MARKS = ["◎", "○", "▲", "△", "穴"];

// 枠番カラー
export const WAKU_COLORS = {
  1: { bg: PAPER_CARD, text: INK, border: INK },
  2: { bg: INK, text: PAPER, border: INK },
  3: { bg: RED, text: PAPER, border: RED },
  4: { bg: "#3A5A7A", text: PAPER, border: "#3A5A7A" },
  5: { bg: "#C9A227", text: INK, border: "#C9A227" },
  6: { bg: "#3E6B4E", text: PAPER, border: "#3E6B4E" },
  7: { bg: "#B5651D", text: PAPER, border: "#B5651D" },
  8: { bg: "#A5507A", text: PAPER, border: "#A5507A" },
};
