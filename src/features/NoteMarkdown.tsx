// 2026-11-21：以 React 元素预览课程笔记的常见 Markdown 结构。
import { createElement } from "react";
import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^\s)]+)\)/g)) {
    const start = match.index;
    tokens.push(text.slice(cursor, start));
    if (match[1]) tokens.push(<code key={start}>{match[1]}</code>);
    else if (match[2]) tokens.push(<strong key={start}>{match[2]}</strong>);
    else if (match[3]) tokens.push(<em key={start}>{match[3]}</em>);
    else if (/^(?:https?:\/\/|mailto:)/i.test(match[5])) {
      tokens.push(<a key={start} href={match[5]} target="_blank" rel="noreferrer">{match[4]}</a>);
    } else tokens.push(match[0]);
    cursor = start + match[0].length;
  }
  tokens.push(text.slice(cursor));
  return tokens;
}

const headingPattern = /^(#{1,6})\s+(.+)$/;
const fencePattern = /^ {0,3}(`{3,}|~{3,})/;
const listPattern = /^\s*([-+*]|\d+\.)\s+(.+)$/;
const quotePattern = /^\s*>\s?/;
const tableCells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
const tableStart = (line: string, separator = "") => line.includes("|") && separator.includes("|")
  && tableCells(separator).every((cell) => /^:?-{3,}:?$/.test(cell));

export function NoteMarkdown({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  for (let row = 0; row < lines.length;) {
    const line = lines[row];
    const key = row++;
    if (!line.trim()) continue;
    const fence = fencePattern.exec(line)?.[1];
    const heading = headingPattern.exec(line);
    const item = listPattern.exec(line);
    if (fence) {
      const code: string[] = [];
      while (row < lines.length && !lines[row].trim().startsWith(fence)) code.push(lines[row++]);
      if (row < lines.length) row++;
      blocks.push(<pre key={key}><code>{code.join("\n")}</code></pre>);
    } else if (heading) {
      blocks.push(createElement(`h${heading[1].length}`, { key }, inline(heading[2])));
    } else if (item) {
      const ordered = /\d/.test(item[1]);
      const List = ordered ? "ol" : "ul";
      const values = [item[2]];
      while (row < lines.length) {
        const next = listPattern.exec(lines[row]);
        if (!next || /\d/.test(next[1]) !== ordered) break;
        values.push(next[2]);
        row++;
      }
      blocks.push(<List key={key}>{values.map((value, index) => <li key={index}>{inline(value)}</li>)}</List>);
    } else if (quotePattern.test(line)) {
      const quote = [line.replace(quotePattern, "")];
      while (row < lines.length && quotePattern.test(lines[row])) quote.push(lines[row++].replace(quotePattern, ""));
      blocks.push(<blockquote key={key}>{inline(quote.join("\n"))}</blockquote>);
    } else if (tableStart(line, lines[row])) {
      const headers = tableCells(line);
      const rows: string[][] = [];
      row++;
      while (row < lines.length && lines[row].includes("|")) rows.push(tableCells(lines[row++]));
      blocks.push(<table key={key}><thead><tr>{headers.map((cell, index) => <th key={index}>{inline(cell)}</th>)}</tr></thead>
        <tbody>{rows.map((values, index) => <tr key={index}>{headers.map((_, column) => <td key={column}>{inline(values[column] ?? "")}</td>)}</tr>)}</tbody></table>);
    } else {
      const paragraph = [line];
      while (row < lines.length && lines[row].trim() && !headingPattern.test(lines[row]) && !fencePattern.test(lines[row])
        && !listPattern.test(lines[row]) && !quotePattern.test(lines[row]) && !tableStart(lines[row], lines[row + 1])) {
        paragraph.push(lines[row++]);
      }
      blocks.push(<p key={key}>{inline(paragraph.join("\n"))}</p>);
    }
  }
  return <div className="course-note-markdown">{blocks}</div>;
}
