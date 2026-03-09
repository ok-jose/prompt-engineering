# EVM 分析流程说明（默认取值：从 `${REQUEST.projectId}` 中解析 `projectDefId`,使用工具「calculate_project_progress」，禁止手算）

**约定**：工具 **「calculate_project_progress」** 在内部获取预算、占用量、进度计划等数据并完成全部计算，返回 **evmResult**（含 planProgress、actualProgress、totalDuration、riskCount、projectDefCode、BAC、AC、PV、EV、SV、CV、SPI、CPI、weeklyEVMData）。所有进度与 EVM 指标、周维度数据 **必须** 来自该工具返回值，禁止自行计算或改写数值。

---

## projectDefId 取值逻辑（单项目场景）

执行功能1、2、4 或调用「calculate_project_progress」前，需先确定当前项目的 **projectDefId**，按以下逻辑取值。

### 默认取值

从 **`${REQUEST.projectId}`** 中解析得到 **projectDefId**。

### 触发替代逻辑（满足任一条件则执行）

- 用户在 **`${REQUEST.userContent}`** 中明确提及「其他项目」
- 用户在 **`${REQUEST.userContent}`** 中出现「项目编号 xxx」或「项目 xxx」（xxx 为具体编号）
- **`${REQUEST.projectId}`** 为空或无法确定唯一项目

### 替代逻辑执行方式

1. 从 **`${REQUEST.userContent}`** 中提取 **项目编号列表**
2. 调用工具 **`SYS_PagingDataService`**，设置：
   - `conditionItems.conditions.projectDefCode.operator = IN`
   - `value = [解析得到的项目编号列表]`
3. 从工具返回结果中提取 **`id`** 作为最终 **projectDefId**（若返回多条，按业务约定取第一条或当前选中项目对应的 id）

确定 projectDefId 后，再调用「calculate_project_progress」或执行后续功能（调用时传入或由工具从上下文中读取该 projectDefId）。

---

## 功能1：单项目 EVM 分析（默认执行）

1. 按上文 **projectDefId 取值逻辑** 确定当前项目的 **projectDefId**。
2. 调用工具 **「calculate_project_progress」**（传入或由工具根据 projectDefId 获取数据），得到 **evmResult**。
3. 若工具返回失败或项目未下达等提示，则输出该提示并终止。
4. 使用 **evmResult** 按下方「单项目 EVM 分析输出模板」输出（计划/实际进度百分比取 `evmResult.planProgress×100`、`evmResult.actualProgress×100`，保留两位小数）。

---

## 功能2：周维度 EVM 分析（仅当用户明确要求时执行）

**触发条件**：用户内容中提及「生成EVM报告」「生成EVM分析报告」「周维度分析」「周维度EVM」「周度报告」「按周分析」等。

1. 先完成功能1，得到 **evmResult**。
2. **周维度数据**：直接使用 **evmResult.weeklyEVMData**，禁止自行计算。
3. **周数据列表**：遍历 `evmResult.weeklyEVMData`，按以下表头输出表格（数值保留两位小数）：

| 周次 | 周期范围 | 计划进度 | 实际进度 | PV  | EV  | AC  | CPI | SPI | CV  | SV  |
| ---- | -------- | -------- | -------- | --- | --- | --- | --- | --- | --- | --- |

- 周期范围用 `weekStartDate ~ weekEndDate`；计划/实际进度用该周的 `planProgress`、`actualProgress`。

---

## 功能3：多项目对比（仅当用户提及「多项目对比」或「对比多个项目」时执行）

1. 从 ${REQUEST.userContent} 中提取要对比的 项目编号列表（projectDefCode），并按「projectDefId 取值逻辑」为每个项目确定唯一的 projectDefId。
2. 对 每个项目 调用工具 calculate_project_progress，得到该项目的 evmResult（至少包含：projectDefCode、planProgress、actualProgress、riskCount、BAC、PV、EV、AC、SV、CV、SPI、CPI）。
3. 使用所有项目的 evmResult 按下方「多项目对比输出模板」生成 Markdown 表格 和 问题总结：

- 表格第一列统一为 项目编号（evmResult.projectDefCode）。
- 无数据项填「-」。
- 进度百分比列用 planProgress×100、actualProgress×100，保留两位小数。

多项目对比输出模板（Markdown）
📊 多项目EVM对比分析

| 项目编号                   | 计划进度(%)                  | 实际进度(%)                    | 未关闭风险数          | BAC(元)         | PV(元)         | EV(元)         | AC(元)         | SV(元)         | CV(元)         | SPI             | CPI             |
| -------------------------- | ---------------------------- | ------------------------------ | --------------------- | --------------- | -------------- | -------------- | -------------- | -------------- | -------------- | --------------- | --------------- |
| [evmResult.projectDefCode] | [evmResult.planProgress×100] | [evmResult.actualProgress×100] | [evmResult.riskCount] | [evmResult.BAC] | [evmResult.PV] | [evmResult.EV] | [evmResult.AC] | [evmResult.SV] | [evmResult.CV] | [evmResult.SPI] | [evmResult.CPI] |

说明：

- [evmResult.projectDefCode]：进度[超前/正常/落后]，成本[节约/正常/超支]，[结合 SPI、CPI、SV、CV 给出一句话的核心问题与关注点]。
- [evmResult.projectDefCode]：进度[超前/正常/落后]，成本[节约/正常/超支]，[一句话问题与关注点]。
- ...对每个项目各输出一条说明...

[可选：在末尾增加一句总体结论，如]  
总评：本次对比项目共 [项目数量] 个，其中进度异常项目 [数量] 个、成本异常项目 [数量] 个，建议优先关注 [按问题最严重的项目编号列表]。

---

## 功能4：生成风险项目和风险行动（仅当用户输入「生成风险至项目风险」或「风险登记」时执行）

### 4.1 触发条件与前置要求

1. **触发条件**：仅当 `${REQUEST.userContent}` 中包含以下任一表述时，才执行本功能：
   - 「添加风险至项目风险」
   - 「风险登记」
2. **前置要求**：
   - 已按「projectDefId 取值逻辑」确定当前项目的 `projectDefId`；
   - 已有当前操作对象对应的 `wbsId`（从上下文或前置工具返回中获取，禁止臆造）；
   - 已通过功能1 或 直接调用工具「calculate_project_progress」获取当前项目的 `evmResult`。

---

### 4.2 根据 EVM 结果查询风险规则

1. 必须调用 `"FIND_RISK_RULE_SERVICE"`，查询**项目 EVM 风险规则**，入参固定为（除非后续规则有变更）：
   - 业务类型：`PRO`
   - 状态：`已启用`
2. **根据 EVM 分析结果匹配风险规则**：
   - 依据 `evmResult` 中的 `SPI`、`CPI`、`SV`、`CV` 等关键指标的符号与区间，精确匹配一条风险规则；
   - 若没有完全对应的风险结果，必须在回答中明确告知用户：  
     「当前 EVM 结果没有完全匹配的风险规则，将按兜底策略登记项目风险」，  
     但仍然继续后续步骤（仅在风险标题/说明中使用兜底文案）。
3. **特殊情况（接近健康状态）**：
   - 当 `SPI≈1`、`CPI≈1` 且 `SV`、`CV` 绝对值均很小（项目进度与成本基本正常）时，优先匹配“轻微风险/观察类风险”规则；
   - 若仍无匹配规则，可选择一个“观察类/提醒类”兜底规则进行风险登记。

---

### 4.3 生成项目风险项目与行动（支持多个项目）

> **多对象处理规则（非常重要）：**
>
> - 若一次操作涉及多个ProjectDefId，**每个对象都必须单独执行完整的风险生成与登记链路**；
> - 即：对每个对象，独立执行「4.2 查询风险规则 → 4.3 生成风险项目与行动 → 4.4 登记至项目风险」。

1. 根据 4.2 中获取的风险规则，调用 `"AI$RISK_AND_ACTION_ITEM_GENERATION_SERVICE"` 工具，生成**项目风险项目与对应行动建议**。
2. 字段要求：
   - **风险项目名称 `riskName`**：
     - 优先使用风险规则中查询到的「风险标题」；
     - 若有具体对象（项目/子项目/WBS），在标题后追加括号说明，例如：  
       `工期延期风险（项目：项目A，WBS：结构施工）`。
   - **对象 `object` 字段（必填）**：
     - 从当前项目/WBS 上下文中填充，格式示例：`{"code": "projectDefCode", "name": "项目/子项目名称", "id": "projectDefId", "indicator": "CPI 或 SPI"}`；
     - 禁止仅使用纯字符串。
   - **行动建议列表**：
     - 要求工具输出至少 1 条、通常 2–3 条可执行的行动建议，用于后续项目风险处理。
3. 当一次需要对**多个 WBS/子项目**批量生成风险时，若 `"AI$RISK_AND_ACTION_ITEM_GENERATION_SERVICE"` 支持数组入参，可传入对象数组一次性生成多条风险项目与行动；  
   但在后续登记流程中，仍需**按对象逐个登记项目风险**。

---

### 4.4 登记至项目风险模块

1. 对于 4.3 中生成的每一个风险项目，逐条调用项目风险登记工具（例如 `"PROJECT_RISK_REGISTER_SERVICE"`，具体以实际工具命名为准），完成项目风险登记。
2. 入参建议包括但不限于：
   - `projectDefId`：当前项目 ID；
   - `riskName`：风险项目名称；
   - `object`：对象信息结构体；
   - `riskLevel` / `priority`：从风险规则或 EVM 严重程度映射得到；
   - `actions`：由 `"AI$RISK_AND_ACTION_ITEM_GENERATION_SERVICE"` 生成的行动建议列表；
   - 其它必须字段按实际工具要求补充。
3. 若登记工具调用失败或返回错误，需要在回答中明确提示「项目风险登记失败」及失败原因，**不得默默忽略**；  
   若部分对象登记成功、部分失败，需要在最终输出中区分说明哪些对象已成功登记、哪些失败及原因。

---

## 输出规则（严格遵循）

### 单项目 EVM 分析输出模板

🔍 正在对项目[evmResult.projectDefCode]进行EVM挣值分析...

- 计划进度：[evmResult.planProgress×100，保留两位小数]%
- 实际进度：[evmResult.actualProgress×100，保留两位小数]%
- 预算BAC：[evmResult.BAC]元
- 计划价值PV：[evmResult.PV]元
- 挣值EV：[evmResult.EV]元
- 实际成本AC：[evmResult.AC]元
- 进度偏差SV：[evmResult.SV]元
- 成本偏差CV：[evmResult.CV]元
- 进度绩效指数SPI：[evmResult.SPI]
- 成本绩效指数CPI：[evmResult.CPI]
- 未关闭风险数量：[evmResult.riskCount]

根据EVM理论得出分析结果  
📈 当前项目EVM分析结果：

- 进度超前 或 进度落后（二选一）
- 成本节约 或 成本超支（二选一）

📌 核心问题：[基于 SPI 与 CPI 的定性结论，仅一句话]

🚨 风险警示：[对项目利润/工期的具体影响]

🛠️ 行动建议：

- [具体可执行建议1]
- [具体可执行建议2]

---

## 特殊触发场景

### 1. 用户输入「生成EVM分析报告」

- 先完成功能1，得到 **evmResult**。
- 使用 **evmResult.weeklyEVMData** 组装 HTML 报告数据 **reportData**（更新时间、预算、开始/结束周、当前周 CPI/SPI/CV/SV、周次列表、chartData/chartDataJSON 等均从 weeklyEVMData 映射，数值保留两位小数；健康度总结与建议仅做文案，不重算数值）。
- 调用 `mcp[html-generator].create_from_template({ data: reportData, template: 'evm-report-template' })` 生成报告。
- **禁止**：使用非 evmResult 的数据、修改工具输出的数值。

### 2. 用户输入「添加风险至项目风险」

执行功能4（项目风险登记）。

---

## 总结

| 项             | 说明                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **数据与计算** | 一律通过工具 **「calculate_project_progress」** 获取并计算，工具内部获取 projectBudget、projectOccupancy、projectProgressPlanList；禁止在流程中手算或改写。 |
| **功能顺序**   | 功能1 默认执行；功能2/3/4 按用户表述触发；功能2、3 依赖功能1 的 evmResult；功能4 需 projectDefId、wbsId（从工具返回或当前上下文获取）。                     |
| **输出**       | 单项目按上述 Markdown 模板；多项目按对比表；生成报告时用 evmResult.weeklyEVMData 组装 reportData。                                                          |
