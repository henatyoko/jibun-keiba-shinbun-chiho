import { PAPER, INK, MINT } from "../lib/colors";
import mascotMain from "../assets/mascot/mascot-main.png";

export default function Masthead({ subtitle }) {
  return (
    <div className="sticky top-0 z-10" style={{ background: MINT, borderBottom: `3px double ${INK}` }}>
      <div className="max-w-md mx-auto px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <img
            src={mascotMain}
            alt="へなちょこ産駒"
            className="w-14 h-14 rounded-full shrink-0"
            style={{ border: `1.5px solid ${PAPER}` }}
          />
          <div className="text-left">
            <h1
              className="text-2xl font-black tracking-wide"
              style={{ color: INK, fontFamily: "'Shippori Mincho', serif" }}
            >
              じぶん競馬新聞　地方版
            </h1>
            <div className="text-[0.625rem] ml-0.5" style={{ color: INK, opacity: 0.7 }}>
              {subtitle}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
