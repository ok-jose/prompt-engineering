function (projectDef,projectBudget,projectOccupancy) {
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const projectProgressPlanList = projectDef?.projectProgressPlanList;
  /**
   * 数据预处理：校验数据格式，并统一转换为日期对象，避免重复实例化和时区问题。
   */
  function preprocessData(projectProgressPlanList) {
    if (!Array.isArray(projectProgressPlanList)) {
      throw new Error('项目进度计划列表必须是一个数组');
    }
  
    const today = new Date();
    today.setHours(0, 0, 0, 0); // 归一化到今天0点，用于精确比较
  
    // 可以在此处添加更多校验，例如检查每个任务是否包含必要字段
    const tasks = projectProgressPlanList
      .map((task) => {
        if (!task.milestone && (!task.planStartDate || !task.planEndDate)) {
          throw new Error('任务必须包含计划开始日期和结束日期');
        }
        const planEndDate = new Date(task.planEndDate);
        const planStartDate = task.planStartDate
          ? new Date(task.planStartDate)
          : planEndDate;
        const constructionPeriod = task.milestone
          ? 1
          : Number(task.constructionPeriod) || 0;
        return {
          ...task,
          planStartDate,
          planEndDate,
          constructionPeriod,
          actualPercent: Number(task.actualPercent) || 0
        };
      })
      .sort((a, b) => {
        const ds = a.planStartDate.getTime() - b.planStartDate.getTime();
        if (ds !== 0) return ds;
        const de = a.planEndDate.getTime() - b.planEndDate.getTime();
        if (de !== 0) return de;
        return String(a.taskId ?? '').localeCompare(String(b.taskId ?? ''));
      });

    return { tasks, today };
  }
  
  /**
   * 计算两个日期之间的天数（包含开始和结束日）
   * @param {Date} start - 开始日期
   * @param {Date} end - 结束日期
   * @returns {number} 天数
   */
  function daysBetween(start, end) {
    const startMs = start instanceof Date ? start.getTime() : start;
    const endMs = end instanceof Date ? end.getTime() : end;
    return Math.floor((endMs - startMs) / MS_PER_DAY) + 1;
  }
  
  /**
   * 计算任务在指定日期之前的计划工期
   * @param {Object} task - 任务对象（含 milestone、planStartDate、planEndDate、constructionPeriod）
   * @param {Date} today - 参考日期
   * @returns {number} 计划工期（天）
   */
  function calculatePlannedDurationUpToDate(task, today) {
    if (task.milestone) {
      const milestoneDate = task.planEndDate;
      if (!milestoneDate) return 0;
      return today >= milestoneDate ? 1 : 0;
    }

    const start = task.planStartDate;
    const end = task.planEndDate;
    if (today < start) return 0;
    if (today >= end) return task.constructionPeriod;

    return daysBetween(start, today);
  }
  
  /**
   * 核心函数：计算项目的进度指标
   */
  function calculateProgressMetrics(tasks, today) {
    let totalProjectDuration = 0;
    let totalPlannedDurationToDate = 0;
    let totalActualDurationToDate = 0;
  
    tasks.forEach(task => {
      // 优化5：使用清晰的变量名代替 D, PD
      const taskTotalDuration = task.constructionPeriod;
      const plannedDurationToDate = calculatePlannedDurationUpToDate(task, today);
      const completionRate = task.actualPercent / 100;
  
      totalProjectDuration += taskTotalDuration;
      totalPlannedDurationToDate += plannedDurationToDate;
      totalActualDurationToDate += plannedDurationToDate * completionRate;
    });
  
    // 优化6：防止除零错误
    if (totalProjectDuration === 0) {
      console.warn('总工期为0，无法计算进度。');
      return { planProgress: 0, actualProgress: 0, totalDuration: 0 };
    }
  
    return {
      planProgress: totalPlannedDurationToDate / totalProjectDuration,
      actualProgress: totalActualDurationToDate / totalProjectDuration,
      totalDuration: totalProjectDuration
    };
  }

  /**
   * 从预算接口返回中提取 BAC（总预算）
   * @param {Object} projectBudget - 预算接口返回，结构为 { wbsVoList: [{ initialBudgetAmount: number }] }
   * @returns {number} BAC，无法解析时返回 0
   */
  function extractBAC(projectBudget) {
    if (!projectBudget) {
      return 0;
    }
    const first = projectBudget[0];
    const amount = first && (first.initialBudgetAmount ?? first.initialBudget);
    return Number(amount) || 0;
  }

  /**
   * 从占用量/成本接口返回中提取总 AC 及带日期的记录（用于周维度成本归属）
   * @param {Object|Array} projectOccupancy - 占用量接口返回，可为 { content/list/records: [...] } 或数组
   * @returns {{ totalAC: number, records: Array<{ validationDate: number, localAmount: number }> }}
   */
  function extractACAndRecords(projectOccupancy) {
    let list = [];
    if (Array.isArray(projectOccupancy)) {
      list = projectOccupancy;
    } else if (projectOccupancy && typeof projectOccupancy === 'object') {
      list = projectOccupancy.content ?? projectOccupancy.list ?? projectOccupancy.records ?? projectOccupancy.data ?? [];
    }
    if (!Array.isArray(list)) list = [];

    let totalAC = 0;
    const records = [];
    for (const row of list) {
      const amount = Number(row.localAmount ?? row.amount ?? 0) || 0;
      const date = row.validationDate ?? row.occurDate ?? row.date;
      const ts = date != null ? (typeof date === 'number' ? date : new Date(date).getTime()) : 0;
      totalAC += amount;
      records.push({ validationDate: ts, localAmount: amount });
    }
    return { totalAC, records };
  }

  /**
   * 计算整体 EVM 指标
   * @param {number} BAC - 总预算
   * @param {number} AC - 实际成本累计
   * @param {number} planProgress - 计划进度 (0-1)
   * @param {number} actualProgress - 实际进度 (0-1)
   * @returns {{ PV: number, EV: number, SV: number, CV: number, SPI: number, CPI: number }}
   */
  function calculateEVM(BAC, AC, planProgress, actualProgress) {
    const PV = planProgress * BAC;
    const EV = actualProgress * BAC;
    const SV = EV - PV;
    const CV = EV - AC;
    const SPI = PV > 0 ? EV / PV : 0;
    const CPI = AC > 0 ? EV / AC : 0;
    const fix = (n) => parseFloat(Number(n).toFixed(2));
    return {
      PV: fix(PV),
      EV: fix(EV),
      SV: fix(SV),
      CV: fix(CV),
      SPI: fix(SPI),
      CPI: fix(CPI)
    };
  }

  /**
   * 周维度 EVM 数据：按提示词规则计算总周数、每周时间范围、进度与成本归属
   * @param {Array} tasks - 预处理后的任务列表（含 Date 型 planStartDate/planEndDate）
   * @param {Date} today - 当前日期基准
   * @param {number} totalDuration - 项目总工期（天）
   * @param {number} BAC - 总预算
   * @param {Array<{ validationDate: number, localAmount: number }>} occupancyRecords - 成本记录
   * @returns {Array<Object>} weeklyEVMData，每项含 weekIndex、weekLabel、周期、进度、PV/EV/AC/CPI/SPI/CV/SV
   */
  function calculateWeeklyEVMData(tasks, today, totalDuration, BAC, occupancyRecords) {
    if (!tasks.length || totalDuration <= 0) return [];

    const todayMs = today.getTime();
    const projectStartMs = Math.min(...tasks.map((t) => (t.milestone ? t.planEndDate.getTime() : t.planStartDate.getTime())));
    const projectStart = new Date(projectStartMs);

    const totalDays = daysBetween(projectStart, today);
    const totalWeeks = Math.max(1, Math.floor((totalDays - 1) / 7) + 1);

    const weekStart = [];
    const weekEnd = [];
    for (let w = 1; w <= totalWeeks; w++) {
      weekStart[w] = projectStartMs + (w - 1) * 7 * MS_PER_DAY;
      weekEnd[w] = Math.min(projectStartMs + w * 7 * MS_PER_DAY - 1, todayMs);
    }

    // 周数据为累计值：第 w 周 = 第1周 + 第2周 + … + 第 w 周（到该周末的累计）
    const sumPlannedDuration = [];
    const sumActualDuration = [];
    const weekPlanProgress = [];
    const weekActualProgress = [];

    for (let w = 1; w <= totalWeeks; w++) {
      const checkDate = new Date(Math.min(weekEnd[w], todayMs));
      let sumPlanned = 0;
      let sumActual = 0;
      tasks.forEach((task) => {
        const pd = calculatePlannedDurationUpToDate(task, checkDate);
        sumPlanned += pd;
        sumActual += pd * (task.actualPercent / 100);
      });
      sumPlannedDuration[w] = sumPlanned;
      sumActualDuration[w] = sumActual;
      weekPlanProgress[w] = sumPlanned / totalDuration;
      weekActualProgress[w] = sumActual / totalDuration;
    }

    const weekAC = [];
    for (let w = 1; w <= totalWeeks; w++) weekAC[w] = 0;
    for (const rec of occupancyRecords) {
      if (!rec.validationDate) continue;
      const costDays = daysBetween(projectStart, new Date(rec.validationDate));
      let costWeekIndex = Math.floor((costDays - 1) / 7) + 1;
      if (costWeekIndex < 1) costWeekIndex = 1;
      if (costWeekIndex > totalWeeks) costWeekIndex = totalWeeks;
      weekAC[costWeekIndex] = (weekAC[costWeekIndex] || 0) + rec.localAmount;
    }

    // AC 累计：第 w 周 = 第1周 + … + 第 w 周的成本
    const cumulativeAC = [0];
    for (let w = 1; w <= totalWeeks; w++) {
      cumulativeAC[w] = cumulativeAC[w - 1] + (weekAC[w] || 0);
    }

    const fix = (n) => parseFloat(Number(n).toFixed(2));
    const weeklyEVMData = [];
    for (let w = 1; w <= totalWeeks; w++) {
      // 第 w 行的 PV/EV/AC 均为累计至第 w 周的值（第1周+…+第w周）
      const PV = weekPlanProgress[w] * BAC;
      const EV = weekActualProgress[w] * BAC;
      const AC = cumulativeAC[w];
      const SV = EV - PV;
      const CV = EV - AC;
      const SPI = PV > 0 ? EV / PV : 0;
      const CPI = AC > 0 ? EV / AC : 0;
      weeklyEVMData.push({
        weekIndex: w,
        weekLabel: `第${w}周`,
        weekStart: weekStart[w],
        weekEnd: weekEnd[w],
        weekStartDate: new Date(weekStart[w]).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        weekEndDate: new Date(weekEnd[w]).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        planProgress: fix(weekPlanProgress[w] * 100),
        actualProgress: fix(weekActualProgress[w] * 100),
        sumPlannedDuration: sumPlannedDuration[w],
        sumActualDuration: sumActualDuration[w],
        PV: fix(PV),
        EV: fix(EV),
        AC: fix(AC),
        CPI: fix(CPI),
        SPI: fix(SPI),
        CV: fix(CV),
        SV: fix(SV)
      });
    }
    return weeklyEVMData;
  }

  const { tasks, today } = preprocessData(projectProgressPlanList);
  const progress = calculateProgressMetrics(tasks, today);
  const BAC = extractBAC(projectBudget);
  const { totalAC, records } = extractACAndRecords(projectOccupancy);
  const evm = calculateEVM(BAC, totalAC, progress.planProgress, progress.actualProgress);
  const riskCount = projectDef?.projectRiskList?.map(item=>item.riskStatus ==="UNCLOSED")?.length || 0;

  const weeklyEVMData = calculateWeeklyEVMData(
    tasks,
    today,
    progress.totalDuration,
    BAC,
    records
  );

  return {
    projectDefCode: projectDef.projectDefCode,
    planProgress: progress.planProgress,
    actualProgress: progress.actualProgress,
    totalDuration: progress.totalDuration,
    riskCount,
    BAC,
    AC: parseFloat(Number(totalAC).toFixed(2)),
    ...evm,
    weeklyEVMData
  };
}