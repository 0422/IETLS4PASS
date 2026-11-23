// 2026-11-19：显示已保存的阅读计时、题组归属及套题测量覆盖情况。
import { submissions } from "../../domain/records";
import { readTiming, timingDuration } from "../../domain/readingTiming";
import type { PracticeRecord, TimingReason } from "../../domain/types";

const reasons: Record<TimingReason, string> = {
  "recovery-tail": "恢复前未保存的时间可能缺失",
  "legacy-draft": "旧草稿从本次恢复开始关联计时",
  "clock-gap": "已略过中断或未观测到的长间隔",
  "missing-mapping": "有题目缺少可靠的计时映射",
};

export function ReadingTimingPanel({ record }: { record: PracticeRecord }) {
  if (record.kind === "listening") return null;
  if (record.kind === "suite") {
    const reading = submissions([record]).filter((child) => child.kind === "reading");
    const measured = reading.flatMap((child) => {
      const value = readTiming(child.readingTiming);
      return value ? [value] : [];
    });
    return <section className="card reading-measurement">
      <h2>套题关联前台时长</h2>
      {measured.length ? <p>合计 {timingDuration(measured.reduce((sum, item) => sum + item.totalMs, 0))}
        {" · "}未分配 {timingDuration(measured.reduce((sum, item) => sum + item.unallocatedMs, 0))}
        {" · "}{measured.length} / {reading.length} 个已提交阅读子篇有测量{measured.some((value) => value.reasons.length) && " · 含部分计时"}</p>
        : <p className="muted">不可用：无可靠计时数据。</p>}
    </section>;
  }
  const timing = readTiming(record.readingTiming);
  if (!timing || timing.attemptId !== record.id || timing.examId !== record.examId || timing.bankId !== record.bankId) {
    return <section className="card reading-measurement"><h2>题目／题组关联前台时长</h2><p className="muted">不可用：无可靠计时数据。</p></section>;
  }
  return <details className="card reading-measurement">
    <summary>关联前台时长 {timingDuration(timing.totalMs)} · 未分配 {timingDuration(timing.unallocatedMs)}
      {timing.reasons.length > 0 && " · 部分计时"}</summary>
    {timing.reasons.length > 0 && <p className="muted">{timing.reasons.map((reason) => reasons[reason] ?? reason).join("；")}。</p>}
    <div className="table-scroll"><table>
      <thead><tr><th>计时归属</th><th>题号</th><th>前台时长</th></tr></thead>
      <tbody>{timing.units.map((unit) => <tr key={unit.id}>
        <td>{unit.kind === "group" ? "题组" : "题目"}</td><td>{unit.labels.join("、")}</td>
        <td>{unit.durationMs === null ? "不可用" : timingDuration(unit.durationMs)}</td>
      </tr>)}</tbody>
    </table></div>
    <p className="muted">只累计练习页可见、窗口有焦点且作答未暂停的时段。未选择题目或题组的时段记为未分配。
      共享题组统一记录。合计使用保存的毫秒值，表格按秒显示。恢复时可能缺少上一段尚未保存的时间。</p>
  </details>;
}
