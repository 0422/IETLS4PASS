// 2026-11-21：录制麦克风单声道样本，输出端保持静音。
/*
class SpeakingAudio extends AudioWorkletProcessor {
  // 2026-11-21：先交付最后一批样本，再在同一个消息端口确认录音结束。
  constructor() {
    super();
    this.finishing = false;
    this.finished = false;
    this.port.onmessage = ({ data }) => {
      if (data === "finish") this.finishing = true;
    };
  }

  process(inputs) {
    // 2026-11-21：结束确认后停止传递麦克风数据。
    if (this.finished) return true;
    const channel = inputs[0]?.[0];
    if (channel) {
      const samples = channel.slice();
      this.port.postMessage(samples, [samples.buffer]);
    }
    // 2026-11-21：等待当前处理周期交付后才通知前端关麦。
    if (this.finishing) {
      this.finished = true;
      this.port.postMessage("finished");
    }
    return true;
  }
}
*/

// 2026-11-21：麦克风连接可跨轮复用，仅在指定录音轮次向页面发送样本。
class SpeakingAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.captureId = null;
    this.finishing = false;
    this.port.onmessage = ({ data: { type, id } }) => {
      if (type === "start") {
        this.captureId = id;
        this.finishing = false;
      } else if (id === this.captureId) {
        if (type === "finish") this.finishing = true;
        if (type === "cancel") this.captureId = null;
      }
    };
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!this.ready && channel?.length) {
      this.ready = true;
      this.port.postMessage({ type: "ready" });
    }
    const id = this.captureId;
    if (id === null) return true;
    if (channel?.length) {
      const samples = channel.slice();
      this.port.postMessage({ type: "samples", id, samples }, [samples.buffer]);
    }
    if (this.finishing) {
      this.captureId = null;
      this.finishing = false;
      this.port.postMessage({ type: "finished", id });
    }
    return true;
  }
}

registerProcessor("speaking-audio", SpeakingAudio);
