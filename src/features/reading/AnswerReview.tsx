// 2026-11-19：显示答案对比、逐题得分和原解析，支持在练习页定位。
import { answerText } from "../../domain/scoring";
import type { AnswerResult, Explanation } from "../../domain/types";

interface Props {
  details: AnswerResult[];
  explanation?: Explanation | null;
  onLocate?: (id: string, explanation?: string) => void;
  study?: boolean;
}

export function AnswerReview({ details, explanation, onLocate, study = false }: Props) {
  const notes = new Map(explanation?.questionExplanations?.flatMap((section) =>
    (section.items ?? []).filter((item) => item.questionId && item.text).map((item) => [item.questionId!, item.text!] as const)));
  return <section className="card review" aria-label="答案与解析">
    <h2>{study ? "标准答案" : "答案对比"}</h2>
    {details.length === 0 ? <p className="muted">此记录没有可用的逐题结果。</p> :
      <div className="table-scroll"><table>
        <thead><tr><th>题号</th>{!study && <th>你的答案</th>}<th>标准答案</th>{!study && <th>得分</th>}{onLocate && <th>定位</th>}</tr></thead>
        <tbody>{details.map((detail) => <tr key={detail.questionId}>
          <th>{detail.label}</th>
          {!study && <td>{answerText(detail.userAnswer)}</td>}
          <td>{answerText(detail.correctAnswer)}</td>
          {!study && <td className={detail.points === detail.possible ? "positive" : "negative"}>{detail.points} / {detail.possible}</td>}
          {onLocate && <td><button type="button" className="text-button" onClick={() => onLocate(detail.questionId, notes.get(detail.questionId))}>查看原文</button></td>}
        </tr>)}</tbody>
      </table></div>}
    {explanation?.questionExplanations?.length ? <div className="explanation-list">
      <h3>题目解析</h3>
      {explanation.questionExplanations.map((section, index) => <details key={index}>
        <summary>{section.sectionTitle || `解析 ${index + 1}`}</summary>
        {section.items?.length ? section.items.map((item, itemIndex) => <div key={itemIndex}>
          <p>{item.text}</p>
          {onLocate && item.questionId && <button type="button" className="text-button" onClick={() => onLocate(item.questionId!, item.text)}>定位第 {item.questionNumber ?? item.questionId} 题</button>}
        </div>) : <p>{section.text}</p>}
      </details>)}
    </div> : explanation === null && <p className="muted">上游快照未提供此篇解析。</p>}
    {Boolean(explanation?.passageNotes?.length) && <details className="passage-notes">
      <summary>段落笔记</summary>
      {explanation?.passageNotes?.map((note, index) => <div key={index}><h4>{note.label}</h4><p>{note.text}</p></div>)}
    </details>}
  </section>;
}
