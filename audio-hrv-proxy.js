/**
 * audio-hrv-proxy.js — Breath HTML 輕量生理訊號採集（HRV Proxy）
 * 
 * 用法:
 *   在 breath.html 中加入此腳本，會在 opt-in 按鈕點擊後啟動。
 *   使用 Web Audio API 麥克風輸入 → FFT 頻譜分析 → 呼吸頻率偵測 → HRV proxy
 * 
 * 設計依據: projects/生態箱app/design-proposals/hrv-proxy-design.md
 * 攝食依據: feeding-039-accelerometer-hrv-and-event-driven-microtracking.md
 * 
 * 建立者: Molty
 * 日期: 2026-09-26
 * 版本: v0.1 (原型)
 */

(function() {
  'use strict';

  const BREATH_FREQ_MIN = 0.1;  // 6 bpm
  const BREATH_FREQ_MAX = 0.5;  // 30 bpm
  const SAMPLE_RATE = 44100;
  const FFT_SIZE = 2048;
  const WINDOW_MS = 30000; // 30秒滑動窗口

  let audioContext = null;
  let analyser = null;
  let mediaStream = null;
  let running = false;
  let breathIntervals = []; // 呼吸間隔（秒）
  let freqHistory = [];     // 頻率歷史
  let animationId = null;

  /**
   * 啟動麥克風呼吸監測
   * @returns {Promise<boolean>} 是否成功啟動
   */
  async function start() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: false, 
          noiseSuppression: false, 
          autoGainControl: false 
        } 
      });
      
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(mediaStream);
      
      analyser = audioContext.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.8;
      
      source.connect(analyser);
      running = true;
      
      freqHistory = [];
      breathIntervals = [];
      
      detectBreathRate();
      return true;
    } catch (err) {
      console.warn('[audio-hrv-proxy] 麥克風啟動失敗:', err);
      return false;
    }
  }

  /**
   * 停止監測
   */
  function stop() {
    running = false;
    if (animationId) cancelAnimationFrame(animationId);
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    analyser = null;
  }

  /**
   * 偵測呼吸頻率
   * 在 0.1-0.5 Hz 範圍內找頻譜峰值
   */
  function detectBreathRate() {
    if (!running || !analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);
    analyser.getFloatFrequencyData(dataArray);

    // 計算每個 bin 對應的頻率
    const binWidth = audioContext.sampleRate / FFT_SIZE;
    
    // 在呼吸頻率範圍內找峰值
    let maxPower = -Infinity;
    let peakBin = 0;
    
    const minBin = Math.floor(BREATH_FREQ_MIN / binWidth);
    const maxBin = Math.ceil(BREATH_FREQ_MAX / binWidth);
    
    for (let i = minBin; i <= maxBin && i < bufferLength; i++) {
      if (dataArray[i] > maxPower) {
        maxPower = dataArray[i];
        peakBin = i;
      }
    }
    
    const peakFreq = peakBin * binWidth; // Hz
    const breathsPerMinute = peakFreq * 60;
    
    // 記錄頻率歷史
    const now = Date.now();
    freqHistory.push({ time: now, freq: peakFreq, bpm: breathsPerMinute });
    
    // 只保留 WINDOW_MS 內的資料
    const cutoff = now - WINDOW_MS;
    while (freqHistory.length > 0 && freqHistory[0].time < cutoff) {
      freqHistory.shift();
    }
    
    // 偵測呼吸間隔（用頻率變化的過零點）
    if (freqHistory.length >= 4) {
      detectBreathIntervals();
    }
    
    animationId = requestAnimationFrame(detectBreathRate);
  }

  /**
   * 偵測呼吸間隔
   * 用頻率歷史的局部極大值作為呼吸週期邊界
   */
  function detectBreathIntervals() {
    const recent = freqHistory.slice(-20); // 最近 20 個樣本
    if (recent.length < 4) return;
    
    const peaks = [];
    for (let i = 1; i < recent.length - 1; i++) {
      if (recent[i].bpm > recent[i-1].bpm && recent[i].bpm >= recent[i+1].bpm) {
        peaks.push(recent[i].time);
      }
    }
    
    // 計算間隔
    breathIntervals = [];
    for (let i = 1; i < peaks.length; i++) {
      const interval = (peaks[i] - peaks[i-1]) / 1000; // 秒
      if (interval > 2 && interval < 20) { // 合理呼吸間隔 2-20 秒
        breathIntervals.push(interval);
      }
    }
  }

  /**
   * 計算 HRV proxy（呼吸間隔變異度）
   * @returns {Object|null}
   */
  function getHRV() {
    if (!running || breathIntervals.length < 3) return null;
    
    const mean = breathIntervals.reduce((a, b) => a + b, 0) / breathIntervals.length;
    const variance = breathIntervals.reduce((a, b) => a + (b - mean) ** 2, 0) / breathIntervals.length;
    const sdnn = Math.sqrt(variance);
    
    // RMSSD
    let sumSquaredDiff = 0;
    for (let i = 1; i < breathIntervals.length; i++) {
      sumSquaredDiff += (breathIntervals[i] - breathIntervals[i-1]) ** 2;
    }
    const rmssd = Math.sqrt(sumSquaredDiff / (breathIntervals.length - 1));
    
    // CV (coefficient of variation)
    const cv = mean > 0 ? sdnn / mean : 0;
    
    return {
      ready: true,
      bpm: freqHistory.length > 0 ? freqHistory[freqHistory.length - 1].bpm : 0,
      meanInterval: Math.round(mean * 100) / 100,
      sdnn: Math.round(sdnn * 100) / 100,
      rmssd: Math.round(rmssd * 100) / 100,
      cv: Math.round(cv * 100) / 100,
      sampleCount: breathIntervals.length
    };
  }

  /**
   * 取得摘要（用於匯出）
   * @returns {Object|null}
   */
  function getSummary() {
    const hrv = getHRV();
    if (!hrv) return null;
    return {
      type: 'audio-hrv-proxy',
      duration: freqHistory.length > 0 ? (freqHistory[freqHistory.length-1].time - freqHistory[0].time) / 1000 : 0,
      avgBpm: hrv.bpm,
      meanInterval: hrv.meanInterval,
      sdnn: hrv.sdnn,
      rmssd: hrv.rmssd,
      cv: hrv.cv,
      samples: hrv.sampleCount
    };
  }

  // 匯出
  window.AudioHRVProxy = {
    start: start,
    stop: stop,
    getHRV: getHRV,
    getSummary: getSummary,
    isRunning: () => running
  };
})();
