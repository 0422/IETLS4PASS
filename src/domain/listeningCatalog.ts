// 2026-11-20：保留参考目录的场景、书号及组内顺序，并用本地题源补齐可练习入口。
import type { ListeningRow, ListeningScene } from "./listening";
// 2026-11-20：按顺序列出四套题，并为一节的录音与题面保留各自可用的入口。
import { canListenToRow } from "./listening";

type CatalogSection = readonly [book: number, test: number, part: number];

const sectionsByScene: Partial<Record<ListeningScene, readonly CatalogSection[]>> = {
  求职: [
    [21, 1, 2],
    [19, 4, 1],
    [18, 2, 1], [18, 4, 1],
    [17, 2, 1],
    [16, 3, 2],
    [15, 1, 1], [15, 3, 1],
    [13, 4, 1],
    [12, 4, 1],
    [9, 1, 1],
    [8, 4, 1],
    [7, 3, 1],
  ],
  经营管理: [
    [21, 3, 2], [21, 4, 2],
    [20, 1, 2], [20, 2, 2],
    [19, 2, 2], [19, 4, 3],
    [18, 1, 2],
    [17, 4, 2],
    [16, 1, 2],
    [14, 1, 2], [14, 3, 3],
    [13, 2, 2],
    [12, 1, 2], [12, 1, 4], [12, 2, 4], [12, 2, 2],
    [11, 2, 2], [11, 3, 4],
    [10, 2, 4], [10, 3, 4],
    [9, 2, 4],
    [8, 3, 4],
    [7, 1, 3],
    [6, 3, 1], [6, 4, 2],
    [5, 1, 4], [5, 2, 2], [5, 4, 3],
  ],
  // 2026-11-20：按截图补齐其余十四个场景，保留书内条目顺序和跨场景条目。
  地理: [
    [15, 2, 4],
    [8, 1, 4],
    [7, 2, 3],
    [5, 2, 4],
  ],
  旅游: [
    [21, 2, 2],
    [20, 4, 1],
    [19, 1, 2],
    [18, 3, 2], [18, 4, 2],
    [17, 1, 2], [17, 2, 2], [17, 3, 1],
    [15, 1, 2], [15, 2, 1], [15, 4, 1],
    [14, 2, 2], [14, 4, 2],
    [12, 1, 1], [12, 2, 1], [12, 2, 2], [12, 4, 2],
    [11, 1, 2], [11, 3, 1], [11, 4, 1], [11, 4, 2],
    [10, 1, 1], [10, 4, 2],
    [9, 2, 2], [9, 3, 2],
    [8, 1, 1], [8, 1, 2], [8, 2, 2], [8, 3, 2],
    [7, 1, 1], [7, 1, 2], [7, 2, 2], [7, 3, 2], [7, 4, 2],
    [6, 1, 2], [6, 2, 2], [6, 3, 2],
    [5, 1, 1],
  ],
  日常生活: [
    [21, 1, 1], [21, 2, 1], [21, 4, 1],
    [20, 1, 1], [20, 2, 1],
    [19, 1, 1], [19, 2, 1], [19, 3, 1], [19, 3, 2],
    [18, 1, 1], [18, 2, 2], [18, 3, 1],
    [17, 1, 1],
    [16, 2, 1], [16, 2, 2], [16, 4, 2],
    [15, 2, 2], [15, 3, 2], [15, 4, 2],
    [14, 1, 1], [14, 3, 2], [14, 4, 1],
    [13, 1, 1], [13, 1, 2], [13, 2, 1],
    [11, 1, 1], [11, 2, 1], [11, 3, 2],
    [10, 2, 1], [10, 2, 2],
    [8, 4, 2],
    [5, 3, 1], [5, 1, 2],
  ],
  建筑环境: [
    [21, 4, 3],
    [20, 3, 2], [20, 4, 2],
    [19, 3, 4],
    [17, 1, 4],
    [14, 1, 4],
    [13, 1, 4],
    [12, 3, 4], [12, 4, 4],
    [11, 2, 4], [11, 4, 4],
    [10, 3, 2],
    [9, 3, 4],
    [5, 3, 4],
  ],
  健康医疗: [
    [21, 4, 4],
    [14, 2, 1],
    [9, 4, 1],
    [8, 2, 4],
  ],
  住宿: [
    [21, 3, 1],
    [20, 3, 1],
    [16, 4, 1],
    [14, 3, 1],
    [13, 3, 1],
    [10, 4, 1],
    [9, 2, 1], [9, 3, 1], [9, 4, 2],
    [8, 3, 1],
    [7, 4, 1],
    [6, 4, 1],
    [5, 4, 1],
  ],
  运动: [
    [19, 4, 2],
    [16, 2, 4],
    [13, 3, 2], [13, 4, 2],
    [10, 1, 2],
    [9, 1, 2],
    [7, 2, 4],
    [6, 1, 1],
  ],
  图书馆: [
    [12, 1, 3], [12, 3, 1],
    [9, 2, 3],
    [6, 4, 3],
    [5, 2, 1], [5, 4, 4],
  ],
  保险: [
    [8, 2, 1],
    [7, 2, 1],
  ],
  新生入学: [
    [17, 3, 2],
    [16, 1, 1], [16, 3, 1],
    [10, 3, 1],
    [6, 1, 3], [6, 2, 1],
    [5, 1, 3], [5, 3, 2], [5, 4, 2],
  ],
  作业讨论: [
    [21, 3, 3],
    [20, 2, 3], [20, 4, 3],
    [19, 1, 3],
    [18, 4, 3],
    [17, 2, 3], [17, 4, 3],
    [16, 2, 3], [16, 3, 3],
    [15, 3, 3], [15, 4, 3],
    [14, 1, 3], [14, 2, 3],
    [13, 1, 3], [13, 2, 3], [13, 3, 3],
    [12, 3, 3], [12, 4, 3],
    [11, 1, 3], [11, 2, 3], [11, 3, 3],
    [10, 1, 3], [10, 3, 3], [10, 4, 3],
    [9, 1, 3], [9, 3, 3], [9, 4, 3],
    [8, 1, 3], [8, 4, 3],
    [7, 4, 3],
    [6, 2, 3], [6, 3, 3],
    [5, 2, 3], [5, 3, 3],
  ],
  人文社科: [
    [21, 1, 4], [21, 2, 4],
    [20, 1, 4], [20, 2, 4], [20, 3, 4],
    [18, 2, 4], [18, 4, 4],
    [17, 2, 4],
    [16, 1, 4], [16, 3, 4],
    [15, 3, 4], [15, 4, 4],
    [14, 2, 4], [14, 3, 4], [14, 4, 4],
    [13, 2, 4], [13, 4, 4],
    [8, 4, 4],
    [7, 1, 4], [7, 3, 4],
    [6, 1, 4], [6, 2, 4], [6, 3, 4],
  ],
  生物: [
    [21, 3, 4],
    [20, 4, 4],
    [19, 2, 4],
    [18, 1, 4],
    [17, 3, 4], [17, 4, 4],
    [16, 4, 4],
    [15, 1, 4],
    [13, 3, 4],
    [11, 1, 4],
    [10, 1, 4],
    [9, 1, 4], [9, 4, 4],
    [8, 2, 3],
    [6, 4, 4],
  ],
  课题研究: [
    [21, 2, 3],
    [20, 1, 3], [20, 3, 3],
    [19, 2, 3], [19, 3, 3],
    [18, 1, 3], [18, 2, 3], [18, 3, 3],
    [17, 1, 3], [17, 3, 3],
    [16, 1, 3], [16, 4, 3],
    [15, 1, 3], [15, 2, 3],
    [14, 4, 3],
    [13, 4, 3],
    [12, 2, 3],
    [11, 4, 3],
    [10, 2, 3], [10, 4, 4],
    [8, 3, 3],
    [7, 3, 3], [7, 4, 4],
  ],
};

interface CatalogItem {
  key: string;
  title: string;
  row?: ListeningRow;
}

const sectionKey = (book: number, test: number, part: number) => `${book}-${test}-${part}`;

// 2026-11-20：按册展示固定的 Test 1–4 和 Section 1–4，题源就绪后关联对应节。
export const listeningBooks = Array.from({ length: 16 }, (_, index) => 20 - index);
const testNumbers = [1, 2, 3, 4];

export function listeningOrderGroups(book: number, rows: readonly ListeningRow[]) {
  const sources = rows.filter((row) => row.book === book);
  // 2026-11-20：剑雅12的导出使用 Test 5–8，按资料原有编号展示。
  const tests = book === 12 && sources.some((row) => (row.test ?? 0) >= 5 && (row.test ?? 0) <= 8)
    ? testNumbers.map((test) => test + 4) : testNumbers;
  return tests.map((test) => ({
    test,
    items: testNumbers.map((section) => {
      const matching = sources.filter((row) => row.test === test && row.section === section);
      const exported = matching.find((row) => row.source.type === "folder" && row.source.entry.exportedListening);
      const row = matching.find((row) => row.potentialPractice &&
        (row.source.type !== "folder" || row.source.entry.exportedListening?.hasAnswers !== false))
        ?? matching.find((row) => row.potentialPractice) ?? exported ?? matching[0];
      const audioRow = [exported, row, ...matching].find(canListenToRow);
      return { key: sectionKey(book, test, section), title: `Section ${section}`, row,
        subtitle: exported?.subtitle ?? row?.subtitle, audioRow };
    }),
  }));
}

// 2026-11-20：用书号、Test 和 Part 匹配已有题源，同时保留同场景中用户新加的题目。
export function listeningCatalogGroups(scene: ListeningScene, rows: readonly ListeningRow[]) {
  const sections = sectionsByScene[scene];
  if (!sections) return undefined;

  const sources = new Map<string, ListeningRow[]>();
  for (const row of rows) {
    if (row.book === undefined || row.test === undefined) continue;
    const key = sectionKey(row.book, row.test, row.section);
    const bucket = sources.get(key) ?? [];
    bucket.push(row);
    sources.set(key, bucket);
  }

  const groups = new Map<number | undefined, CatalogItem[]>();
  const addItem = (book: number | undefined, item: CatalogItem) => {
    const group = groups.get(book) ?? [];
    group.push(item);
    groups.set(book, group);
  };

  const included = new Set<string>();
  for (const [book, test, part] of sections) {
    const key = sectionKey(book, test, part);
    const title = `Test ${test} Part ${part}`;
    const matching = sources.get(key);
    if (!matching) {
      addItem(book, { key, title });
      continue;
    }
    for (const row of matching) {
      addItem(book, { key: row.id, title, row });
      included.add(row.id);
    }
  }

  for (const row of rows) {
    if (row.scene !== scene || included.has(row.id)) continue;
    const title = row.test === undefined ? row.title : `Test ${row.test} Part ${row.section}`;
    addItem(row.book, { key: row.id, title, row });
  }

  return [...groups].sort(([leftBook], [rightBook]) => (rightBook ?? 0) - (leftBook ?? 0))
    .map(([book, items]) => ({ book, items }));
}
