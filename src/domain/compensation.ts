// 统一补偿口径：音栓台账与温湿度观测共用同一套常量和函数

/** 温度补偿系数：每偏离基准温度 1°C，音分偏移 2.0 cent */
export const TEMP_COEF_CENTS = 2.0;

/** 默认基准温度 T₀ */
export const DEFAULT_BASE_TEMP = 20;

/** 补偿后偏差绝对值超过该值视为超限 */
export const DEVIATION_LIMIT_CENTS = 8;

export const round1 = (n: number): number => Math.round(n * 10) / 10;

/** 某观测温度下的期望音分偏移（相对基准温度） */
export const expectedOffset = (obsTemp: number, baseTemp: number): number =>
  round1(TEMP_COEF_CENTS * (obsTemp - baseTemp));

/** 补偿后偏差 = 实测音分 − 期望偏移；基准温度一变，该结果立即作废重算 */
export const compensateCents = (
  measuredCents: number,
  obsTemp: number,
  baseTemp: number
): number => round1(measuredCents - expectedOffset(obsTemp, baseTemp));

/** 对外展示的统一口径说明，音栓台账与温湿度观测必须引用同一段文字 */
export const COMPENSATION_BASIS_TEXT =
  `统一补偿口径：以基准温度 T₀ 为参照，温度每偏离 1 °C，音管音分按 ${TEMP_COEF_CENTS} cent 线性偏移；` +
  `补偿后偏差 = 实测音分 − ${TEMP_COEF_CENTS} × (观测温度 − T₀)。湿度只作观测存档，不参与音分修正。` +
  `音栓台账的均值与温湿度观测的期望偏移均按此口径计算，基准温度变更后全部结果立即作废重算。`;
