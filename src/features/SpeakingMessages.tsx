// 2026-11-21：考官和考生使用紧凑语音条，考官文字可逐条展开。
import { AudioLines, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SpeakingMessage } from "../domain/speakingPractice";
import { desktop, errorText } from "../services/desktop";

interface ContextMenu {
  index: number;
  x: number;
  y: number;
  anchor: HTMLButtonElement;
}

interface Props {
  messages: SpeakingMessage[];
  finished: boolean;
  hasVoice: boolean;
  canPlay: boolean;
  playingQuestion?: number;
  playingAudio?: string;
  onQuestion: (text: string, index: number) => void;
  onAudio: (id: string) => void;
}

export function SpeakingMessages({ messages, finished, hasVoice, canPlay, playingQuestion, playingAudio, onQuestion, onAudio }: Props) {
  const [visible, setVisible] = useState(() => new Map<number, boolean>());
  const [menu, setMenu] = useState<ContextMenu>();
  const menuAction = useRef<HTMLButtonElement>(null);
  const isVisible = (index: number) => visible.get(index) ?? (finished || !hasVoice);

  useEffect(() => {
    if (!menu) return;
    menuAction.current?.focus();
    const dismiss = () => setMenu(undefined);
    const outside = (event: PointerEvent) => {
      if (event.target !== menuAction.current) dismiss();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
        menu.anchor.focus();
      }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [menu]);

  function openMenu(index: number, anchor: HTMLButtonElement, x: number, y: number) {
    setMenu({ index, anchor, x: Math.max(6, Math.min(x, window.innerWidth - 144)), y: Math.max(6, Math.min(y, window.innerHeight - 54)) });
  }

  return <>
    {messages.map((item, index) => {
      const examiner = item.role === "assistant";
      const isPlaying = examiner ? playingQuestion === index : Boolean(item.audioId && playingAudio === item.audioId);
      return <article className={`speaking-message ${item.role}`} key={index}>
        <b>{examiner ? "考官" : "我"}</b>
        {(examiner ? hasVoice : item.audioId) && <button className="speaking-voice-bar" type="button"
          data-playing={isPlaying || undefined} disabled={!canPlay}
          aria-label={isPlaying ? "停止播放" : examiner ? "播放考官问题" : "播放我的录音"}
          aria-haspopup={examiner ? "menu" : undefined}
          title={examiner ? "点击播放，右键可显示或隐藏文本" : "点击播放原录音"}
          onClick={() => examiner ? onQuestion(item.content, index) : item.audioId && onAudio(item.audioId)}
          onContextMenu={examiner ? (event) => {
            event.preventDefault();
            openMenu(index, event.currentTarget, event.clientX, event.clientY);
          } : undefined}
          onKeyDown={examiner ? (event) => {
            if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            openMenu(index, event.currentTarget, rect.left, rect.bottom + 4);
          } : undefined}>
          {isPlaying ? <Square size={13} fill="currentColor" aria-hidden="true" /> : <Play size={13} fill="currentColor" aria-hidden="true" />}
          <AudioLines size={21} aria-hidden="true" />
          {!examiner && item.durationMs != null && <span>{Math.max(1, Math.ceil(item.durationMs / 1000))}″</span>}
        </button>}
        {(!examiner || isVisible(index)) && <p lang="en">{item.content}</p>}
      </article>;
    })}
    {menu && createPortal(<div className="speaking-voice-menu" role="menu" aria-label="考官问题" style={{ left: menu.x, top: menu.y }}>
      <button ref={menuAction} type="button" role="menuitem" onClick={() => {
        setVisible((previous) => new Map(previous).set(menu.index, !isVisible(menu.index)));
        setMenu(undefined);
        menu.anchor.focus();
      }}>{isVisible(menu.index) ? "隐藏文本" : "显示文本"}</button>
    </div>, document.body)}
  </>;
}

// 2026-11-21：历史语音按需读取，切换、取消或退出时释放临时播放资源。
export function useSpeakingPlayback(onError: (message: string) => void) {
  const [playing, setPlaying] = useState<string>();
  const current = useRef<{ id: string; audio?: HTMLAudioElement; url?: string }>();

  function clear() {
    const active = current.current;
    current.current = undefined;
    active?.audio?.pause();
    if (active?.url) URL.revokeObjectURL(active.url);
  }

  function stop() {
    clear();
    setPlaying(undefined);
  }

  useEffect(() => clear, []);

  async function play(sessionId: string, audioId: string) {
    const wasPlaying = current.current?.id === audioId;
    stop();
    if (wasPlaying) return;
    const request: NonNullable<typeof current.current> = { id: audioId };
    current.current = request;
    setPlaying(audioId);

    function finish() {
      if (current.current === request) stop();
    }
    try {
      const bytes = await desktop.speakingAudio(sessionId, audioId);
      if (current.current !== request) return;
      request.url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      const audio = new Audio(request.url);
      request.audio = audio;
      audio.onended = finish;
      audio.onerror = () => {
        if (current.current !== request) return;
        finish();
        onError("口语录音播放失败。");
      };
      await audio.play();
    } catch (reason) {
      if (current.current !== request) return;
      finish();
      onError(errorText(reason));
    }
  }

  return { playing, play, stop };
}
