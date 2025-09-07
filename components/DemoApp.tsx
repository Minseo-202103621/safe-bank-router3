"use client";

import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, LineChart, Line
} from "recharts";
import {
  PiggyBank, ShieldCheck, ArrowRight, ChevronRight,
  Sparkles, Banknote, Settings
} from "lucide-react";

/* ================= Utils ================= */
const KRW = (n: number) => (n ?? 0).toLocaleString("ko-KR");
const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** 고정 팔레트: 보호/초과/비보호 일관 색상 */
const CHART = {
  protected: "#16a34a",     // 보호 (green-600)
  excess: "#f59e0b",         // 초과 (amber-500)
  nonProtected: "#e11d48",   // 비보호 (rose-600)
};

/* ================= Types (from our APIs) ================= */
type Account = {
  id: string;
  institution: string;
  license: string;
  type: "demand" | "term" | "fx_deposit" | "trust_protected" | "investment";
  currency: "KRW" | "USD" | string;
  balance: number;
  fxRate?: number;
  term?: number;
  product_name?: string;
};

type CoverageRow = {
  license: string;
  institutions: string;
  products: string[]; // 사용 안하지만 타입 유지
  tier: "제1금융권" | "제2금융권" | "기타";
  eligible: number;
  protected: number;
  excess: number;
  nonProtected: number;
  accounts?: Account[]; // 보유 상품 세부 (coverage API에서 내려줌)
};

type CoverageTotals = {
  eligible: number;
  protected: number;
  excess: number;
  nonProtected: number;
  tier1: number;
  tier2: number;
};

/* ================= UI primitives ================= */
type CardProps = {
  title: ReactNode;
  subtitle?: string;
  right?: ReactNode;
  className?: string;
  children?: ReactNode;
};
const Card = ({ title, subtitle, right, className, children }: CardProps) => (
  <div className={`rounded-2xl bg-white shadow-sm border border-slate-200 p-5 ${className ?? ""}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-slate-900 font-semibold text-lg">{title}</div>
        {subtitle && <div className="text-slate-500 text-sm mt-1">{subtitle}</div>}
      </div>
      {right}
    </div>
    <div className="mt-4">{children}</div>
  </div>
);

type Tone = "blue" | "green" | "amber" | "rose";
const toneClass: Record<Tone, string> = {
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
};
const Badge = ({ tone = "blue", children }: { tone?: Tone; children?: ReactNode }) => (
  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border ${toneClass[tone]}`}>
    {children}
  </span>
);

const TabBtn = ({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 rounded-xl border text-sm font-medium transition-all ${
      active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
    }`}
  >
    {children}
  </button>
);

/* ================= Demo constants (rates) ================= */
const rateOffers = [
  { institution: "국민은행",   license: "국민은행 라이선스",   product: "정기예금 12M(복리)", tenorM: 12, rate: 0.033 },
  { institution: "신한은행",   license: "신한은행 라이선스",   product: "정기예금 6M(단리)",  tenorM: 6,  rate: 0.031 },
  { institution: "하나은행",   license: "하나은행 라이선스",   product: "정기예금 3M(단리)",  tenorM: 3,  rate: 0.029 },
  { institution: "농협은행",   license: "농협은행 라이선스",   product: "정기예금 12M(단리)", tenorM: 12, rate: 0.034 },
  { institution: "저축은행C",  license: "저축은행C 라이선스",  product: "정기예금 12M",      tenorM: 12, rate: 0.039 },
];

/* ================= Helpers (client-side routing logic) ================= */
function toKRW(a: Account) {
  if (a.currency === "USD") return Math.round((a.balance ?? 0) * (a.fxRate ?? 1400));
  return a.balance ?? 0;
}

function computeRouting(limitPerLicense: number, accounts: Account[]) {
  // 유동성 보전 가정
  const liquidityReserve = 10_000_000;
  const demandKRW = accounts
    .filter(a => a.type === "demand")
    .reduce((s, a) => s + toKRW(a), 0);
  const idleCash = Math.max(0, demandKRW - liquidityReserve);

  // 현재 각 라이선스 사용량(보호대상 타입만)
  const usedByLicense: Record<string, number> = {};
  for (const a of accounts) {
    if (["demand","term","fx_deposit","trust_protected"].includes(a.type)) {
      usedByLicense[a.license] = (usedByLicense[a.license] ?? 0) + toKRW(a);
    }
  }

  // 금리 높은 순으로 배분 (단일 상품 6천만 cap)
  const sorted = [...rateOffers].sort((x, y) => y.rate - x.rate);
  const plan: { institution: string; license: string; product: string; rate: number; tenorM: number; allocate: number; reason: string }[] = [];
  let remain = idleCash;

  for (const o of sorted) {
    if (remain <= 0) break;
    const used = usedByLicense[o.license] ?? 0;
    const already = plan.filter(p => p.license === o.license).reduce((s, p) => s + p.allocate, 0);
    const room = Math.max(0, limitPerLicense - used - already);
    if (room <= 0) continue;
    const alloc = Math.min(remain, room, 60_000_000);
    if (alloc > 0) {
      plan.push({
        institution: o.institution,
        license: o.license,
        product: o.product,
        rate: o.rate,
        tenorM: o.tenorM,
        allocate: alloc,
        reason: `한도여유 ${KRW(room)} / 금리 ${(o.rate*100).toFixed(2)}% / 만기 ${o.tenorM}M`,
      });
      remain -= alloc;
    }
  }

  const projectedInterest = Math.round(plan.reduce((s, p) => s + p.allocate * p.rate, 0));
  return { liquidityReserve, idleCash, plan, projectedInterest };
}

/* ================= Main ================= */
export default function DemoApp() {
  const [tab, setTab] = useState<"dashboard" | "coverage" | "router" | "rates" | "about">("coverage");
  const [use100m, setUse100m] = useState(true);
  const limit = use100m ? 100_000_000 : 50_000_000;

  const [rows, setRows] = useState<CoverageRow[]>([]);
  const [totals, setTotals] = useState<CoverageTotals>({
    eligible: 0, protected: 0, excess: 0, nonProtected: 0, tier1: 0, tier2: 0,
  });
  const [mydata, setMydata] = useState<Account[]>([]);

  useEffect(() => {
    (async () => {
      const r1 = await fetch("/api/coverage", { cache: "no-store" });
      const j1 = await r1.json();
      setRows(j1.rows ?? []);
      setTotals(j1.totals ?? { eligible:0, protected:0, excess:0, nonProtected:0, tier1:0, tier2:0 });

      const r2 = await fetch("/api/mydata", { cache: "no-store" });
      const j2 = await r2.json();
      setMydata(Array.isArray(j2) ? j2 : []);
    })();
  }, []);

  // 한도 토글 시 가상 재계산
  const adjusted = useMemo(() => {
    if (!rows.length) return { rows: [], totals };
    const cloned = rows.map((r) => {
      const protectedAmt = Math.min(r.eligible, limit);
      const excess = Math.max(0, r.eligible - limit);
      return { ...r, protected: protectedAmt, excess };
    });
    const t = cloned.reduce(
      (acc, r) => {
        acc.eligible += r.eligible;
        acc.protected += r.protected;
        acc.excess += r.excess;
        acc.nonProtected += r.nonProtected;
        if (r.tier === "제1금융권") acc.tier1 += r.eligible;
        else if (r.tier === "제2금융권") acc.tier2 += r.eligible;
        return acc;
      },
      { eligible: 0, protected: 0, excess: 0, nonProtected: 0, tier1: 0, tier2: 0 } as CoverageTotals
    );
    return { rows: cloned, totals: t };
  }, [rows, limit, totals]);

  // 라우팅 제안 (mydata 기반)
  const routing = useMemo(() => computeRouting(limit, mydata), [limit, mydata]);

  const donut = [
    { name: "보호", value: adjusted.totals.protected },
    { name: "초과", value: adjusted.totals.excess },
    { name: "비보호", value: adjusted.totals.nonProtected },
  ];
  const tier2Ratio = pct(adjusted.totals.tier2, adjusted.totals.eligible || 1);

  // Router “전/후” 보호율(근사)
  const afterProtected = Math.min(
    adjusted.totals.protected + routing.idleCash,
    adjusted.totals.eligible
  );
  const beforeRate = pct(adjusted.totals.protected, adjusted.totals.eligible + adjusted.totals.nonProtected);
  const afterRate  = pct(afterProtected, adjusted.totals.eligible + adjusted.totals.nonProtected);

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-white/70 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-900 font-semibold text-lg">
            <ShieldCheck className="w-6 h-6 text-blue-600" />
            세이프뱅크 라우터
          </div>
          <div className="flex items-center gap-2">
            <TabBtn active={tab === "dashboard"} onClick={() => setTab("dashboard")}>대시보드</TabBtn>
            <TabBtn active={tab === "coverage"} onClick={() => setTab("coverage")}>보호 계산</TabBtn>
            <TabBtn active={tab === "router"} onClick={() => setTab("router")}>AI 라우터</TabBtn>
            <TabBtn active={tab === "rates"} onClick={() => setTab("rates")}>금리 비교</TabBtn>
            <TabBtn active={tab === "about"} onClick={() => setTab("about")}>안내</TabBtn>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-3 rounded-2xl bg-white border border-slate-200 p-2">
            <span className="text-sm text-slate-600 px-2">보호한도</span>
            <button
              onClick={() => setUse100m(false)}
              className={`px-3 py-1.5 rounded-xl text-sm ${!use100m ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              5천만 (시행 전)
            </button>
            <button
              onClick={() => setUse100m(true)}
              className={`px-3 py-1.5 rounded-xl text-sm ${use100m ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              1억 (시행 후)
            </button>
          </div>
          {tier2Ratio >= 50 && <Badge tone="rose">경고: 2금융권 비중 {tier2Ratio}%</Badge>}
        </div>

        {/* ====== COVERAGE ====== */}
        {tab === "coverage" && (
          <div className="grid md:grid-cols-12 gap-5">
            <div className="md:col-span-8">
              <Card title="보호 계산 상세" subtitle="기관/라이선스별 집계표">
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="py-2 pr-4">금융회사(브랜드) · 보유 상품</th>
                        <th className="py-2 pr-4">금융권</th>
                        <th className="py-2 pr-4">보호대상 합계</th>
                        <th className="py-2 pr-4">보호</th>
                        <th className="py-2 pr-4">초과</th>
                        <th className="py-2 pr-4">비보호</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adjusted.rows.map((r, i) => (
                        <tr key={i} className="border-t text-slate-800 align-top">
                          <td className="py-2 pr-4">
                            <div className="font-medium">{r.institutions}</div>
                            <div className="text-xs text-slate-500">{r.license}</div>

                            {/* 보유 상품(실제 보유 목록) */}
                            {r.accounts && r.accounts.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {r.accounts.slice(0, 5).map((a, idx) => (
                                  <div key={idx} className="text-xs text-slate-600">
                                    • {a.product_name ?? "상품명 미상"} —{" "}
                                    {a.currency === "USD"
                                      ? `${(a.balance ?? 0).toLocaleString("en-US")} USD`
                                      : `${(a.balance ?? 0).toLocaleString("ko-KR")} 원`}
                                  </div>
                                ))}
                                {r.accounts.length > 5 && (
                                  <div className="text-xs text-slate-500">외 {r.accounts.length - 5}건</div>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-4">{r.tier}</td>
                          <td className="py-2 pr-4">{KRW(r.eligible)}</td>
                          <td className="py-2 pr-4 text-emerald-700">{KRW(r.protected)}</td>
                          <td className="py-2 pr-4 text-amber-700">{KRW(r.excess)}</td>
                          <td className="py-2 pr-4 text-rose-700">{KRW(r.nonProtected)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            <div className="md:col-span-4">
              <Card title="데이터 요약" subtitle="전제·주요 규칙">
                <ul className="space-y-2 text-slate-700 text-sm">
                  <li>· 동일 라이선스 합산, 1인당 한도 <b>{use100m ? "1억" : "5천만"}원</b></li>
                  <li>· <b>원본보전형 신탁</b>, <b>외화예금(환산)</b> 포함 / 투자성 상품은 비보호</li>
                  <li>· 외화 환율은 데모값 사용(USD 1,400원)</li>
                  <li>· 실제 판단은 금융회사 기록·법령·KDIC 고시에 따름</li>
                </ul>
                <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="text-xl font-semibold text-slate-900">
                      {pct(adjusted.totals.protected, adjusted.totals.eligible + adjusted.totals.nonProtected)}%
                    </div>
                    <div className="text-xs text-slate-500">보호율(전체)</div>
                  </div>
                  <div>
                    <div className="text-xl font-semibold text-amber-700">{KRW(adjusted.totals.excess)}</div>
                    <div className="text-xs text-slate-500">초과금액</div>
                  </div>
                  <div>
                    <div className="text-xl font-semibold text-rose-700">{KRW(adjusted.totals.nonProtected)}</div>
                    <div className="text-xs text-slate-500">비보호(투자성)</div>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* ====== DASHBOARD ====== */}
        {tab === "dashboard" && (
          <div className="grid md:grid-cols-12 gap-5">
            <div className="md:col-span-4">
              <Card
                title={<div className="flex items-center gap-2"><PiggyBank className="w-5 h-5 text-blue-600" /> 총 보호대상 잔액</div>}
                subtitle="외화/신탁 포함(보호대상만)"
              >
                <div className="text-3xl font-semibold text-slate-900">{KRW(adjusted.totals.eligible)} 원</div>
                <div className="mt-3 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-slate-500 text-xs uppercase tracking-wider">보호</div>
                    <div className="text-slate-900 text-xl font-semibold">{KRW(adjusted.totals.protected)} 원</div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-xs uppercase tracking-wider">초과</div>
                    <div className="text-slate-900 text-xl font-semibold">{KRW(adjusted.totals.excess)} 원</div>
                  </div>
                </div>
              </Card>
            </div>

            <div className="md:col-span-8">
              <Card title="포트폴리오 보호/초과/비보호 분포" subtitle="도넛 차트">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={donut}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={60}
                        outerRadius={85}
                        paddingAngle={3}
                      >
                        {/* 보호 → 초과 → 비보호 (고정 색상) */}
                        <Cell fill={CHART.protected} />
                        <Cell fill={CHART.excess} />
                        <Cell fill={CHART.nonProtected} />
                      </Pie>
                      <RTooltip formatter={(v: number, n: string) => [`${KRW(v)} 원`, n]} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            <div className="md:col-span-12 grid md:grid-cols-2 gap-5">
              <Card title="금융권 분포" subtitle="제1/제2/기타">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: "제1금융권", value: adjusted.totals.tier1 },
                          { name: "제2금융권", value: adjusted.totals.tier2 },
                          { name: "기타", value: Math.max(0, adjusted.totals.eligible - (adjusted.totals.tier1 + adjusted.totals.tier2)) },
                        ]}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={3}
                      >
                        {/* 분포 차트는 팔레트 자유롭게, 본 문의는 ‘보호/초과/비보호’ 일관성 문제였음 */}
                        <Cell fill="#2563eb" />
                        <Cell fill="#16a34a" />
                        <Cell fill="#f59e0b" />
                      </Pie>
                      <RTooltip formatter={(v: number, n: string) => [`${KRW(v)} 원`, n]} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card title="라이선스(금융회사)별 현황" subtitle="동일 라이선스 합산 기준">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={adjusted.rows.map(r => ({
                        name: r.institutions,
                        보호: r.protected,
                        초과: r.excess,
                        비보호: r.nonProtected,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tickFormatter={(v) => KRW(v)} />
                      <RTooltip formatter={(v: number) => `${KRW(v)} 원`} />
                      <Legend />
                      <Bar dataKey="보호"   stackId="a" fill={CHART.protected} />
                      <Bar dataKey="초과"   stackId="a" fill={CHART.excess} />
                      <Bar dataKey="비보호" stackId="b" fill={CHART.nonProtected} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* ====== AI ROUTER ====== */}
        {tab === "router" && (
          <div className="grid md:grid-cols-12 gap-5">
            <div className="md:col-span-7">
              <Card
                title={<div className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-blue-600" /> AI 라우터 제안</div>}
                subtitle="금리·한도·유동성 고려(추천형, 자동이체 없음)"
              >
                <div className="flex items-center gap-3 mb-4">
                  <Badge tone="amber">대기성 자금 {KRW(routing.idleCash)}원</Badge>
                  <Badge tone="blue">유동성 보전 {KRW(routing.liquidityReserve)}원</Badge>
                </div>

                <div className="space-y-3">
                  {routing.plan.map((p, i) => (
                    <div key={i} className="rounded-xl border border-slate-200 p-4 bg-slate-50 flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-slate-900">{p.institution} · {p.product}</div>
                        <div className="text-sm text-slate-600">
                          배분 {KRW(p.allocate)}원 · 금리 {(p.rate*100).toFixed(2)}% · 만기 {p.tenorM}개월
                        </div>
                        <div className="text-xs text-slate-500 mt-1">사유: {p.reason}</div>
                      </div>
                      <button className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm">
                        실행 안내 <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {routing.plan.length === 0 && (
                    <div className="text-sm text-slate-500">배분 가능한 대기성 자금이 없습니다.</div>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-end text-sm text-slate-700">
                  예상 연이자(세전): <b className="ml-2">{KRW(routing.projectedInterest)} 원</b>
                </div>
              </Card>
            </div>

            <div className="md:col-span-5">
              <Card title="제약조건" subtitle="설명가능한 추천">
                <ul className="text-sm text-slate-700 space-y-2">
                  <li>· 라이선스별 한도 {KRW(limit)}원까지 신규 배분</li>
                  <li>· 최소 유동성 {KRW(routing.liquidityReserve)}원 유지</li>
                  <li>· 단일 상품 최대 6천만(데모)</li>
                  <li>· 사용자 제외기관/선호만기 등 정책 추가 가능</li>
                </ul>
              </Card>

              <Card title="시뮬레이션 변화" className="mt-4" subtitle="전/후 비교(근사)">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={[
                      { name: "현재", 보호율: beforeRate },
                      { name: "제안적용", 보호율: afterRate }
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis domain={[0,100]} tickFormatter={(v)=>`${v}%`} />
                      <RTooltip formatter={(v:number)=>`${v}%`}/>
                      <Line type="monotone" dataKey="보호율" stroke={CHART.protected} strokeWidth={3} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* ====== RATES ====== */}
        {tab === "rates" && (
          <div className="grid md:grid-cols-12 gap-5">
            <div className="md:col-span-12">
              <Card title="금리 비교(참고)" subtitle="은행연합회 소비자포털 공시 참고값(세전)">
                <div className="grid md:grid-cols-2 gap-3">
                  {[...rateOffers].sort((a,b)=>b.rate-a.rate).map((o, i) => (
                    <div key={i} className="flex items-center justify-between border rounded-xl p-4 bg-white">
                      <div>
                        <div className="font-semibold text-slate-900">{o.institution} · {o.product}</div>
                        <div className="text-sm text-slate-600">만기 {o.tenorM}개월 · 금리 {(o.rate*100).toFixed(2)}%</div>
                      </div>
                      <button className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm">
                        자세히 <ArrowRight className="w-4 h-4"/>
                      </button>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-slate-500 mt-3">※ 실제 가입 전 각 기관의 원문 공시를 확인하세요. 공시 금리는 예시이며 수시 변동됩니다.</div>
              </Card>
            </div>
          </div>
        )}

        {/* ====== ABOUT ====== */}
        {tab === "about" && (
          <div className="grid md:grid-cols-12 gap-5">
            <div className="md:col-span-7">
              <Card title="서비스 안내" subtitle="개인 보유상품 보호판정 + 라우팅 추천">
                <ul className="list-disc pl-5 text-slate-700 space-y-2 text-sm">
                  <li><b>마이데이터(모의)</b>로 보유 상품명을 만들고, <b>KDIC 카탈로그</b>와 매칭해 보호 여부를 판정합니다.</li>
                  <li><b>외화예금</b>과 <b>원본보전형 금전신탁</b>을 보호대상에 포함하고, 동일 라이선스 합산을 적용합니다.</li>
                  <li>‘시행 전(5천만)’/‘시행 후(1억)’ 토글로 정책 변경 효과를 비교합니다.</li>
                  <li>대기성 자금과 금리를 고려한 <b>AI 라우팅</b> 추천을 제공합니다.</li>
                </ul>
              </Card>
            </div>
            <div className="md:col-span-5">
              <Card title="프린트/PDF" subtitle="제출용 캡처">
                <div className="flex items-center gap-2">
                  <button onClick={()=>window.print()} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 text-white text-sm"><Banknote className="w-4 h-4"/> 인쇄/저장</button>
                  <button className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border text-sm"><Settings className="w-4 h-4"/> 옵션</button>
                </div>
                <div className="text-xs text-slate-500 mt-2">브라우저 인쇄로 PDF 제출본을 만들 수 있습니다.</div>
              </Card>
            </div>
          </div>
        )}
      </main>

      <footer className="py-10 text-center text-slate-500 text-xs">
        © 2025 SafeBank Router.
      </footer>
    </div>
  );
}
