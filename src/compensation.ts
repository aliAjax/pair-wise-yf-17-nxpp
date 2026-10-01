// 同一套补偿口径 —— 音栓台账与温湿度观测共用，不得各写一套系数
//
// 物理依据：声速 c ∝ √(热力学温度 T)，管频 f 与声速成正比，
// 因此温度引起的音分偏移 = 600 · log2(T2 / T1)（T 为开尔文）。
// 湿度采用工程近似：湿空气摩尔质量更小，声速略增。

// 温度补偿（音分）：测量温度相对于基准温度的偏移量
function tempEffectCents(tempC: number, baseTempC: number): number {
  return 600 * Math.log2((tempC + 273.15) / (baseTempC + 273.15));
}

// 湿度补偿（音分）：测量湿度相对于基准湿度的偏移量
function humidityEffectCents(humidity: number, baseHumidity: number): number {
  return 1200 * Math.log2(1 + 0.000066 * (humidity - baseHumidity));
}

// 总补偿量（音分）
function totalEffectCents(
  tempC: number,
  humidity: number,
  baseTempC: number,
  baseHumidity: number = COMPENSATION.baseHumidity
): number {
  return (
    tempEffectCents(tempC, baseTempC) + humidityEffectCents(humidity, baseHumidity)
  );
}

// 实测音分偏差 → 折算到基准条件下的偏差
function reducedDeviation(
  measuredCents: number,
  tempC: number,
  humidity: number,
  baseTempC: number
): number {
  return measuredCents - totalEffectCents(tempC, humidity, baseTempC);
}

// 基准温度附近的温度补偿系数（音分/°C），由公式求导得到，台账直接引用
function tempCoefficient(baseTempC: number): number {
  return 600 / (Math.LN2 * (baseTempC + 273.15));
}

export const COMPENSATION = {
  baseHumidity: 50, // 基准湿度（%RH）
  tempEffectCents,
  humidityEffectCents,
  totalEffectCents,
  reducedDeviation,
  tempCoefficient,
};

export function fmtCents(n: number | null | undefined): string {
  if (n == null) return "—";
  const v = Math.round(n * 10) / 10;
  return `${v > 0 ? "+" : ""}${v}`;
}

export function fmtDateTime(t: number): string {
  const d = new Date(t);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}
