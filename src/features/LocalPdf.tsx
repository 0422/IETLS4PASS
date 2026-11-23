// 2026-11-23：独立保留阅读和听力题面使用的本地 PDF 打开入口。
import { useMutation } from "@tanstack/react-query";
import { desktop, errorText } from "../services/desktop";

export function LocalPdf({ folderId, relative }: { folderId: string; relative?: string }) {
  const open = useMutation({ mutationFn: (file: string) => desktop.openBankPdf(folderId, file) });
  if (!relative) return <span className="muted">本地 PDF 不可用</span>;
  return <span className="table-actions">
    <button type="button" className="button secondary" disabled={open.isPending} onClick={() => open.mutate(relative)}>打开本地 PDF</button>
    {open.error && <span role="alert">{errorText(open.error)}</span>}
  </span>;
}
