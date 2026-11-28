// 2026-11-20：阅读工作区加载单篇作答与历史回放。
import { useQuery } from "@tanstack/react-query";
// 2026-11-19：题图在绘制答题控件前就绪，PDF 通过已绑定的目录打开。
import { useCallback, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { PracticeDraft, ReadingAsset } from "../../domain/types";
import { examKey, MAIN_BANK, mainMedia, readingAsset, useBankIndex, useCustomBanks } from "../../services/banks";
import { useFolderMedia } from "../../services/folderBanks";
// 2026-11-23：保留已绑定题面的 PDF 打开入口。
import { LocalPdf } from "../LocalPdf";
import { desktop, desktopAvailable, errorText } from "../../services/desktop";
import { ReadingAttempt } from "./ReadingAttempt";
import { ReadingReplay } from "./ReadingReplay";

export function ReadingWorkspace() {
  const { bankId = MAIN_BANK, examId: requested = "" } = useParams();
  // 2026-11-19：已提交的篇目也可从回放头部切换。
  const [search] = useSearchParams();
  const replayId = search.get("mode") === "replay" ? search.get("record") ?? "" : "";
  const study = search.get("mode") === "study";
  const index = useBankIndex();
  const banks = useCustomBanks();
  const aliases = bankId === MAIN_BANK ? index.data?.aliases : banks.data?.find((folder) => folder.id === bankId)?.value.catalog?.aliases;
  const examId = (Object.hasOwn(aliases ?? {}, requested) && aliases?.[requested]) || requested;
  const asset = useQuery({
    queryKey: examKey(bankId, examId),
    queryFn: () => readingAsset(bankId, examId, banks.data ?? []),
    enabled: Boolean(examId && (bankId === MAIN_BANK ? index.isSuccess : banks.isSuccess)),
  });
  const resources = useFolderMedia(bankId, asset.data?.localMedia);
  const urls = resources.urls;
  const media = useCallback((file: string) => bankId === MAIN_BANK ? mainMedia(file) : urls?.[file], [bankId, urls]);
  const error = asset.error || (bankId === MAIN_BANK ? index.error : banks.error);
  if (error) return <p className="notice danger" role="alert">{errorText(error)}</p>;
  if (bankId !== MAIN_BANK && !desktopAvailable()) return <p className="notice">自定义题库在桌面应用中可用。</p>;
  if (!asset.data || resources.loading) return <p className="muted">正在读取题目与本机题图…</p>;
  const pdf = bankId === MAIN_BANK ? null : <div className="bank-media-strip"><LocalPdf folderId={bankId} relative={asset.data.pdfPath} /></div>;
  const missing = resources.missing.length > 0 ? <p className="notice">有 {resources.missing.length} 张题图当前无法读取。</p> : null;
  // 2026-11-20：回放只打开选中的历史篇目，正常练习使用单篇草稿标识。
  if (study || replayId || asset.data.resourceOnly) {
    return <>
      {pdf}{missing}
      {asset.data.resourceOnly && <p className="notice">此资源可查看。当前目录缺少完整的结构化作答或答案数据。</p>}
      <ReadingReplay key={replayId || "study"} asset={asset.data} bankId={bankId} recordId={replayId || undefined} media={media} />
    </>;
  }
  const draftId = `${bankId}:${examId}`;
  return <>{pdf}{missing}<OpenReading key={draftId} draftId={draftId} asset={asset.data} bankId={bankId} media={media} /></>;
}

// 2026-11-20：写者和恢复草稿只用于当前单篇练习。
function OpenReading({ draftId, asset, bankId, media }: {
  draftId: string; asset: ReadingAsset; bankId: string; media: (key: string) => string | undefined;
}) {
  const [writerId] = useState(() => crypto.randomUUID());
  const [seed] = useState<PracticeDraft>(() => {
    const now = new Date().toISOString();
    return { id: crypto.randomUUID(), bankId, examId: asset.exam.examId, answers: {}, startedAt: now, updatedAt: now,
      elapsedMs: 0 };
  });
  const enabled = desktopAvailable();
  const opened = useQuery({
    queryKey: ["open-reading", draftId, writerId],
    queryFn: () => desktop.openReading(draftId, writerId, seed),
    enabled,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  if (opened.error) return <div className="notice danger" role="alert">
    {errorText(opened.error)} <button className="text-button" type="button" onClick={() => void opened.refetch()}>重试打开</button>
  </div>;
  if (enabled && !opened.data) return <p className="muted">正在恢复本机草稿…</p>;
  return <ReadingAttempt asset={asset} draftId={draftId} initial={opened.data?.draft ?? seed}
    recovered={opened.data?.recovered ?? false} writerId={enabled ? writerId : undefined} mediaUrl={media} />;
}
