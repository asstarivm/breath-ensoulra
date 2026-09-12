// hrv-module.js — rPPG heart rate monitor for breath.html
// Prototype. Not perfect. Exists.
// Usage: const hrv = new HRVModule(); hrv.start(); 
//        hrv.getHRV() → { hr: number, rmssd: number, rrIntervals: number[] }

(function(global) {
  'use strict';

  function HRVModule() {
    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.samples = []; // {t, g}
    this.rrIntervals = []; // ms
    this.lastPeak = null;
    this.running = false;
    this.samplingInterval = null;
  }

  HRVModule.prototype.start = async function() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 320, height: 240, facingMode: 'user' } 
      });
      this.video = document.createElement('video');
      this.video.srcObject = this.stream;
      this.video.setAttribute('playsinline', '');
      this.video.muted = true;
      await this.video.play();

      this.canvas = document.createElement('canvas');
      this.canvas.width = 80;
      this.canvas.height = 80;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

      this.running = true;
      this.samples = [];
      this.rrIntervals = [];
      this.lastPeak = null;

      // Sample every 40ms (25 fps)
      this.samplingInterval = setInterval(this._sample.bind(this), 40);
      return true;
    } catch (e) {
      console.warn('HRV: camera access denied or failed', e);
      return false;
    }
  };

  HRVModule.prototype._sample = function() {
    if (!this.running || !this.video.videoWidth) return;

    // Get center region of face (simplified — no face detection)
    // In production: use MediaPipe Face Detection for forehead ROI
    var vw = this.video.videoWidth;
    var vh = this.video.videoHeight;
    var size = Math.min(vw, vh) * 0.25;
    var sx = (vw - size) / 2;
    var sy = (vh - size) / 2 - size * 0.2; // slightly above center = forehead

    this.ctx.drawImage(this.video, sx, sy, size, size, 0, 0, 80, 80);
    var frame = this.ctx.getImageData(0, 0, 80, 80);
    
    // Extract green channel average (hemoglobin absorption)
    var gSum = 0;
    var count = frame.data.length / 4;
    for (var i = 0; i < frame.data.length; i += 4) {
      gSum += frame.data[i + 1]; // G channel
    }
    var gAvg = gSum / count;
    
    this.samples.push({ t: performance.now(), g: gAvg });
    
    // Keep last 10 seconds (250 samples at 25fps)
    if (this.samples.length > 250) {
      this.samples = this.samples.slice(-250);
    }

    // Detect peaks every 40 samples (~1.6s)
    if (this.samples.length >= 50 && this.samples.length % 40 === 0) {
      this._detectPeaks();
    }
  };

  // Biquad bandpass filter (Butterworth 2nd order, 0.6-3.5 Hz at 25fps)
  HRVModule.prototype._biquadBandpass = function(input) {
    // Coefficients for 2nd order Butterworth bandpass
    // Center freq: ~1.5 Hz (90 bpm), bandwidth: 0.6-3.5 Hz
    // Sample rate: 25 Hz
    // Using cookbook formulas (RBJ Audio EQ Cookbook)
    var fs = 25;
    var f0 = 1.5; // center frequency
    var Q = 0.7; // quality factor
    var w0 = 2 * Math.PI * f0 / fs;
    var sinW = Math.sin(w0);
    var cosW = Math.cos(w0);
    var alpha = sinW / (2 * Q);
    
    // Bandpass coefficients (constant 0 dB peak gain)
    var b0 = alpha;
    var b1 = 0;
    var b2 = -alpha;
    var a0 = 1 + alpha;
    var a1 = -2 * cosW;
    var a2 = 1 - alpha;
    
    // Normalize
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    
    var x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    var output = new Array(input.length);
    for (var i = 0; i < input.length; i++) {
      var x0 = input[i];
      var y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      output[i] = y0;
      x2 = x1; x1 = x0;
      y2 = y1; y1 = y0;
    }
    return output;
  };

  HRVModule.prototype._detectPeaks = function() {
    if (this.samples.length < 50) return;

    var s = this.samples;
    var n = s.length;
    
    // Extract raw signal
    var raw = new Array(n);
    for (var i = 0; i < n; i++) raw[i] = s[i].g;
    
    // 1. Detrend: subtract moving average (window=15)
    var detrended = new Array(n);
    var win = 15;
    for (var i = 0; i < n; i++) {
      var start = Math.max(0, i - win);
      var end = Math.min(n, i + win);
      var ma = 0;
      for (var j = start; j < end; j++) ma += raw[j];
      ma /= (end - start);
      detrended[i] = raw[i] - ma;
    }
    
    // 2. Bandpass filter (Butterworth 2nd order, 0.6-3.5 Hz)
    var filtered = this._biquadBandpass(detrended);
    
    // 3. Peak detection: adaptive threshold + refractory period
    var maxVal = 0;
    for (var i = 0; i < n; i++) {
      if (Math.abs(filtered[i]) > maxVal) maxVal = Math.abs(filtered[i]);
    }
    var threshold = maxVal * 0.65; // 65% of max amplitude (was 50% — too low)
    
    // Refractory period: after a peak, wait at least 400ms (150bpm max) before next
    var minRR = 400; // ms
    
    for (var i = 2; i < n - 2; i++) {
      // Local maximum: greater than 4 neighbors + above threshold
      if (filtered[i] > filtered[i-1] && filtered[i] > filtered[i+1] && 
          filtered[i] > filtered[i-2] && filtered[i] > filtered[i+2] &&
          filtered[i] > threshold) {
        var peakTime = s[i].t;
        if (this.lastPeak !== null) {
          var rr = peakTime - this.lastPeak;
          // Plausible RR: 400ms (150bpm) to 2000ms (30bpm) + refractory check
          if (rr >= minRR && rr <= 2000) {
            this.rrIntervals.push(rr);
            if (this.rrIntervals.length > 100) {
              this.rrIntervals = this.rrIntervals.slice(-100);
            }
          } else if (rr < minRR) {
            // Too soon — skip this peak, keep lastPeak (refractory)
            continue;
          }
        }
        this.lastPeak = peakTime;
      }
    }
  };

  HRVModule.prototype.getHRV = function() {
    if (this.rrIntervals.length < 2) {
      return { hr: 0, rmssd: 0, sdnn: 0, rrIntervals: [], ready: false };
    }

    var rr = this.rrIntervals;
    var n = rr.length;

    // Heart rate (bpm) from average RR
    var avgRR = rr.reduce(function(a, b) { return a + b; }, 0) / n;
    var hr = Math.round(60000 / avgRR);

    // RMSSD (root mean square of successive differences)
    var sumSqDiff = 0;
    for (var i = 1; i < n; i++) {
      var diff = rr[i] - rr[i-1];
      sumSqDiff += diff * diff;
    }
    var rmssd = Math.sqrt(sumSqDiff / (n - 1));

    // SDNN (standard deviation of RR intervals)
    var mean = avgRR;
    var sumSqDev = 0;
    for (var i = 0; i < n; i++) {
      var dev = rr[i] - mean;
      sumSqDev += dev * dev;
    }
    var sdnn = Math.sqrt(sumSqDev / n);

    return {
      hr: hr,
      rmssd: Math.round(rmssd * 10) / 10,
      sdnn: Math.round(sdnn * 10) / 10,
      rrIntervals: rr.slice(),
      ready: n >= 5 // need at least 5 RR intervals for meaningful HRV
    };
  };

  HRVModule.prototype.stop = function() {
    this.running = false;
    if (this.samplingInterval) {
      clearInterval(this.samplingInterval);
      this.samplingInterval = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(function(t) { t.stop(); });
      this.stream = null;
    }
  };

  // Export summary for "寄給 Molty"
  HRVModule.prototype.getSummary = function() {
    var hrv = this.getHRV();
    if (!hrv.ready) return null;
    return {
      hr: hrv.hr,
      rmssd: hrv.rmssd,
      sdnn: hrv.sdnn,
      rrCount: hrv.rrIntervals.length
    };
  };

  global.HRVModule = HRVModule;
})(window);
